import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, LevelFormat, Header, Footer, PageNumber, ShadingType,
  TabStopType, TabStopPosition,
} from 'docx';
import { renderLineChartSVG, type ChartOptions } from './chartSvg';
import { renderGridMapSVG, gridMapHeight } from './gridMapSvg';
import { inlineRuns, plainText, hasMarks, pdfFontStyle, inlineToDocx } from './serializeDoc';
import type { ReportDoc, DocNode, ReportInputs, ReportMeta, MetricRow, ChartData, NewsRef, CustomChartData, GridSnapshot } from './api';

// Branded client-side report export — no server, no Puppeteer. Walks the TipTap
// document (headings, rich paragraphs, lists, quotes + the embedded metrics /
// chart / custom-chart / news blocks) and renders it to PDF (jsPDF) and Word
// (docx). Charts are rasterised from SVG → PNG via a canvas. The header, footer,
// disclaimer and source attribution are unchanged from the original exporter.

const DISCLAIMER =
  'This report is for general information only and does not constitute a price quotation or financial advice. Market figures are indicative. Green Shift Energy Consulting.';
const dateStr = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const RGB = {
  green: [64, 168, 0] as [number, number, number],
  greenDark: [49, 131, 0] as [number, number, number],
  ink: [43, 42, 46] as [number, number, number],
  muted: [107, 106, 112] as [number, number, number],
  line: [231, 232, 230] as [number, number, number],
  up: [194, 65, 12] as [number, number, number],
  down: [46, 125, 50] as [number, number, number],
};

function detailRows(inputs: ReportInputs): [string, string | undefined][] {
  return [
    ['Company', inputs.companyName],
    ['Contact', inputs.clientName ? `${inputs.clientName}${inputs.contact ? ' · ' + inputs.contact : ''}` : undefined],
    ['Sites / meters', inputs.sites],
    ['Current supplier', inputs.currentSupplier],
    ['Contract end', inputs.contractEnd],
    ['Annual consumption', inputs.consumption],
  ];
}

// ── shared image helpers ──
async function loadImage(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl, w: img.naturalWidth || 300, h: img.naturalHeight || 80 });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch {
    return null;
  }
}

function svgToPngDataUrl(svg: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] ?? '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// SVG options for the two chart node types.
const priceChartOpts = (c: ChartData): ChartOptions => ({
  points: c.points, title: c.label, unit: c.unit, source: c.sourceName, width: 760, height: 300,
});
const customChartOpts = (d: CustomChartData): ChartOptions => ({
  points: d.points.map((p) => ({ t: p.label, v: p.value })),
  title: d.title, unit: d.unit, source: d.sourceName, width: 760, height: 300,
  kind: d.kind, categoryAxis: true,
});

const fileBase = (inputs: ReportInputs) => (inputs.companyName || 'energy-report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const nodes = (doc: ReportDoc): DocNode[] => doc.content ?? [];

// Drop a generation-map block whose snapshot never loaded (it would render nothing)
// together with the heading that solely introduces it — avoids an orphan heading
// if a report is exported in the brief window before the map's data resolves.
function exportNodes(doc: ReportDoc): DocNode[] {
  const ns = nodes(doc);
  const out: DocNode[] = [];
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    if (n.type === 'gridMap' && !(n.attrs as { snapshot?: unknown } | undefined)?.snapshot) {
      const prev = ns[i - 1];
      if (prev && prev.type === 'heading' && out[out.length - 1] === prev) out.pop();
      continue;
    }
    out.push(n);
  }
  return out;
}

// Generation-map block → rasterised SVG. Rendered at a larger width for a crisp
// export; the height is derived deterministically from the same layout module.
const GRID_MAP_W = 700;
function gridMapCaption(s: GridSnapshot): string {
  if (!s.interconnectors?.length) return 'Estimated regional carbon intensity (NESO model).';
  const net = s.interconnectors.reduce((a, i) => a + i.mw, 0);
  const top = s.interconnectors.slice(0, 3).map((i) => `${i.name} ${Math.abs(i.mw).toLocaleString('en-GB')}MW`).join(', ');
  return `Net interconnector ${net >= 0 ? 'import' : 'export'} ${Math.abs(net).toLocaleString('en-GB')} MW — ${top}. Estimated regional carbon intensity (NESO model).`;
}

// ───────────────────────── PDF (jsPDF) ─────────────────────────

export async function exportReportPdf(inputs: ReportInputs, doc: ReportDoc, meta: ReportMeta): Promise<{ blob: Blob; filename: string }> {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 48;
  const cW = W - M * 2;
  let y = M;

  // Reserve room for the running footer; continuation pages start below the
  // running header (both drawn in a post-pass once the page count is known).
  const FOOTER_H = 34;
  const ensure = (need: number) => { if (y + need > H - M - FOOTER_H) { pdf.addPage(); y = M + 14; } };

  // — Branded cover header —
  const logo = await loadImage('/gse.png');
  if (logo) pdf.addImage(logo.dataUrl, 'PNG', M, y, 110, (logo.h / logo.w) * 110, undefined, 'FAST');
  pdf.setFontSize(9).setTextColor(...RGB.muted);
  pdf.text('Market & Procurement Report', W - M, y + 8, { align: 'right' });
  pdf.text(dateStr(), W - M, y + 20, { align: 'right' });
  y += 42;
  pdf.setDrawColor(...RGB.green).setLineWidth(2).line(M, y, W - M, y);
  y += 26;
  pdf.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...RGB.ink).text('Energy Market Report', M, y);
  y += 17;
  pdf.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...RGB.muted)
    .text('Prepared for ' + (inputs.companyName || inputs.clientName || 'your business'), M, y);
  y += 16;

  // Client details in a tinted two-column panel.
  const details = detailRows(inputs).filter(([, v]) => v) as [string, string][];
  if (details.length) {
    const colW = (cW - 42) / 2;
    const rowH = 26;
    const nRows = Math.ceil(details.length / 2);
    const panelH = nRows * rowH + 12;
    pdf.setFillColor(244, 250, 239);
    pdf.setDrawColor(...RGB.line);
    pdf.roundedRect(M, y, cW, panelH, 6, 6, 'FD');
    details.forEach(([k, v], i) => {
      const px = M + 14 + (i % 2) * (colW + 14);
      const py = y + 17 + Math.floor(i / 2) * rowH;
      pdf.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...RGB.greenDark).text(k.toUpperCase(), px, py);
      pdf.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...RGB.ink);
      pdf.text(pdf.splitTextToSize(String(v), colW)[0] ?? '', px, py + 11);
    });
    y += panelH + 20;
  } else {
    y += 8;
  }

  // — Node renderers —
  const pdfHeading = (node: DocNode) => {
    const level = (node.attrs?.level as number) ?? 2;
    const text = plainText(node);
    if (!text) return;
    if (level <= 2) {
      ensure(28);
      pdf.setFillColor(...RGB.green).rect(M, y - 8.5, 3, 11, 'F');
      pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...RGB.greenDark).text(text.toUpperCase(), M + 9, y);
      y += 5;
      pdf.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, y, W - M, y);
      y += 12;
    } else {
      ensure(20);
      pdf.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...RGB.ink).text(text, M, y);
      y += 15;
    }
  };

  const lineH = 13;
  const drawRich = (runs: ReturnType<typeof inlineRuns>, startX: number, width: number) => {
    pdf.setFontSize(10);
    let x = startX;
    ensure(lineH);
    const newline = () => { y += lineH; x = startX; ensure(lineH); };
    for (const run of runs) {
      if (run.text === '\n') { newline(); continue; }
      pdf.setFont('helvetica', pdfFontStyle(run));
      pdf.setTextColor(...(run.href ? RGB.green : RGB.ink));
      for (const word of run.text.split(/(\s+)/)) {
        if (word === '') continue;
        if (x === startX && /^\s+$/.test(word)) continue; // drop leading space at line start
        const wWidth = pdf.getTextWidth(word);
        if (x + wWidth > startX + width && x > startX) newline();
        pdf.text(word, x, y);
        if (run.href && word.trim()) pdf.link(x, y - 9, wWidth, 11, { url: run.href });
        x += wWidth;
      }
    }
    y += lineH;
  };

  const pdfParagraph = (node: DocNode) => {
    const runs = inlineRuns(node);
    if (!runs.length) { y += 6; return; }
    if (!hasMarks(node)) {
      pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
      const text = runs.map((r) => r.text).join('');
      for (const seg of text.split('\n')) {
        for (const ln of pdf.splitTextToSize(seg || ' ', cW)) { ensure(lineH); pdf.text(ln, M, y); y += lineH; }
      }
    } else {
      drawRich(runs, M, cW);
    }
    y += 5;
  };

  const pdfList = (node: DocNode, ordered: boolean) => {
    pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
    let idx = 1;
    for (const li of node.content ?? []) {
      const paras = (li.content ?? []).filter((c) => c.type === 'paragraph');
      paras.forEach((para, pi) => {
        const text = plainText(para).replace(/\n/g, ' ');
        const prefix = pi === 0 ? (ordered ? `${idx}.` : '•') : '';
        const lines = pdf.splitTextToSize(text || ' ', cW - 16);
        lines.forEach((ln: string, i: number) => {
          ensure(lineH);
          if (i === 0 && prefix) pdf.text(prefix, M, y);
          pdf.text(ln, M + 16, y);
          y += lineH;
        });
      });
      idx++;
    }
    y += 5;
  };

  const pdfBlockquote = (node: DocNode) => {
    const startY = y - 9;
    pdf.setFont('helvetica', 'italic').setFontSize(10).setTextColor(...RGB.muted);
    for (const para of node.content ?? []) {
      const text = plainText(para).replace(/\n/g, ' ');
      for (const ln of pdf.splitTextToSize(text || ' ', cW - 18)) { ensure(lineH); pdf.text(ln, M + 18, y); y += lineH; }
    }
    pdf.setDrawColor(...RGB.line).setLineWidth(2).line(M + 6, startY, M + 6, y - lineH + 3);
    y += 7;
  };

  const pdfMetrics = (node: DocNode) => {
    const rows = (node.attrs?.rows as MetricRow[]) ?? [];
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Metric', 'Value', 'Change']],
      body: rows.map((r) => [
        r.label,
        `${r.value ?? '—'} ${r.unit}`,
        r.changePct == null ? '' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`,
      ]),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 4, lineColor: RGB.line, textColor: RGB.ink },
      headStyles: { fillColor: [244, 250, 239], textColor: RGB.greenDark, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 2) {
          const t = String(d.cell.raw ?? '');
          if (t.startsWith('-')) d.cell.styles.textColor = RGB.down;
          else if (t.startsWith('+')) d.cell.styles.textColor = RGB.up;
        }
      },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    const asOf = node.attrs?.asOf as string | undefined;
    if (asOf) { ensure(12); pdf.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...RGB.muted).text(`Indicative market data, as of ${asOf}.`, M, y); y += 12; }
  };

  const pdfChartImage = async (opts: ChartOptions, caption?: string) => {
    const imgH = (cW * 300) / 760;
    ensure(imgH + 6);
    const png = await svgToPngDataUrl(renderLineChartSVG(opts), 760, 300);
    pdf.addImage(png, 'PNG', M, y, cW, imgH, undefined, 'MEDIUM');
    y += imgH + 6;
    if (caption) {
      pdf.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...RGB.muted);
      for (const ln of pdf.splitTextToSize(caption, cW)) { ensure(11); pdf.text(ln, M, y); y += 11; }
      y += 2;
    }
  };

  const pdfGridMap = async (snap: GridSnapshot | null, mode: 'intensity' | 'fuel') => {
    if (!snap?.regions?.length) return;
    const svgH = gridMapHeight(GRID_MAP_W);
    const png = await svgToPngDataUrl(renderGridMapSVG({ regions: snap.regions, mode, width: GRID_MAP_W }), GRID_MAP_W, svgH);
    const w = Math.min(cW, 340);
    const h = (svgH / GRID_MAP_W) * w;
    ensure(h + 6);
    pdf.addImage(png, 'PNG', M, y, w, h, undefined, 'MEDIUM');
    y += h + 4;
    const cap = gridMapCaption(snap);
    pdf.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...RGB.muted);
    for (const ln of pdf.splitTextToSize(cap, cW)) { ensure(11); pdf.text(ln, M, y); y += 11; }
    y += 2;
  };

  const pdfNews = (items: NewsRef[]) => {
    pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
    for (const it of items) {
      for (const ln of pdf.splitTextToSize(`•  ${it.source}: ${it.title}`, cW)) { ensure(lineH); pdf.text(ln, M, y); y += lineH; }
    }
  };

  const pdfImage = async (node: DocNode) => {
    const src = node.attrs?.src as string | undefined;
    if (!src) return;
    const img = await loadImage(src);
    if (!img || img.w < 8 || img.h < 8) return; // ignore degenerate/pinprick images (jsPDF's compressor hangs on them)
    const w = Math.min(cW, img.w);
    const h = (img.h / img.w) * w;
    ensure(h + 8);
    pdf.addImage(img.dataUrl, img.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', M, y, w, h, undefined, 'MEDIUM');
    y += h + 8;
  };

  for (const node of exportNodes(doc)) {
    switch (node.type) {
      case 'heading': pdfHeading(node); break;
      case 'paragraph': pdfParagraph(node); break;
      case 'bulletList': pdfList(node, false); break;
      case 'orderedList': pdfList(node, true); break;
      case 'blockquote': pdfBlockquote(node); break;
      case 'metricsTable': pdfMetrics(node); break;
      case 'priceChart': await pdfChartImage(priceChartOpts(node.attrs?.chart as ChartData)); break;
      case 'customChart': {
        const d = node.attrs?.data as CustomChartData;
        await pdfChartImage(customChartOpts(d), d.caption);
        break;
      }
      case 'newsList': pdfNews((node.attrs?.items as NewsRef[]) ?? []); break;
      case 'gridMap': await pdfGridMap(node.attrs?.snapshot as GridSnapshot | null, (node.attrs?.mode as 'intensity' | 'fuel') ?? 'intensity'); break;
      case 'image': await pdfImage(node); break;
      default: if (node.content?.length) pdfParagraph(node);
    }
    y += 6;
  }

  // — Disclaimer + attribution flow at the end of the content —
  ensure(44);
  y += 6;
  pdf.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, y, W - M, y);
  y += 12;
  pdf.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(...RGB.muted);
  for (const ln of pdf.splitTextToSize(DISCLAIMER, cW)) { ensure(10); pdf.text(ln, M, y); y += 10; }
  if (meta.attributions?.length) {
    y += 3;
    pdf.setFont('helvetica', 'normal');
    for (const ln of pdf.splitTextToSize(meta.attributions.join(' '), cW)) { ensure(10); pdf.text(ln, M, y); y += 10; }
  }

  // — Running header (pages 2+) and footer with page numbers (all pages) —
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    if (i > 1) {
      pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...RGB.muted);
      pdf.text('Energy Market Report' + (inputs.companyName ? ` — ${inputs.companyName}` : ''), M, 30);
      pdf.text(dateStr(), W - M, 30, { align: 'right' });
      pdf.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, 36, W - M, 36);
    }
    pdf.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, H - 36, W - M, H - 36);
    pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...RGB.muted);
    pdf.text('Green Shift Energy Consulting — indicative information only, not financial advice', M, H - 24);
    pdf.text(`Page ${i} of ${pageCount}`, W - M, H - 24, { align: 'right' });
  }

  return { blob: pdf.output('blob'), filename: `${fileBase(inputs)}.pdf` };
}

// ───────────────────────── Word (docx) ─────────────────────────

function docMetricsTable(rows: MetricRow[]): Table {
  const cell = (children: TextRun[], align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
    new TableCell({
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
      },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      children: [new Paragraph({ alignment: align, children })],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((r) => new TableRow({
      children: [
        cell([new TextRun({ text: r.label })]),
        cell([new TextRun({ text: `${r.value ?? '—'} ${r.unit}` })], AlignmentType.RIGHT),
        cell([new TextRun({ text: r.changePct == null ? '' : `${r.changePct > 0 ? '+' : ''}${r.changePct}%`, color: (r.changePct ?? 0) >= 0 ? 'C2410C' : '2E7D32' })], AlignmentType.RIGHT),
      ],
    })),
  });
}

function docHeadingNode(node: DocNode): Paragraph {
  const text = plainText(node);
  const level = (node.attrs?.level as number) ?? 2;
  return level <= 2
    ? new Paragraph({
        spacing: { before: 240, after: 100 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 3 } },
        children: [new TextRun({ text: text.toUpperCase(), bold: true, color: '318300', size: 22 })],
      })
    : new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text, bold: true, color: '2B2A2E', size: 20 })] });
}

// Client details rendered as a tinted panel (single-cell table with brand fill).
function docDetailsPanel(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: 'F4FAEF' },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
          left: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
          right: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
        },
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        children: rows.map(([k, v]) => new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${k.toUpperCase()}  `, bold: true, size: 14, color: '318300' }),
            new TextRun({ text: v, size: 19, color: '2B2A2E' }),
          ],
        })),
      })],
    })],
  });
}

function docList(node: DocNode, ordered: boolean): Paragraph[] {
  const out: Paragraph[] = [];
  for (const li of node.content ?? []) {
    for (const para of (li.content ?? []).filter((c) => c.type === 'paragraph')) {
      out.push(new Paragraph({
        ...(ordered ? { numbering: { reference: 'report-ol', level: 0 } } : { bullet: { level: 0 } }),
        spacing: { after: 40 },
        children: inlineToDocx(para),
      }));
    }
  }
  return out;
}

function docBlockquote(node: DocNode): Paragraph[] {
  return (node.content ?? []).map((para) => new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'E7E8E6', space: 8 } },
    children: inlineToDocx(para, { italics: true, color: '6B6A70' }),
  }));
}

export async function exportReportDocx(inputs: ReportInputs, doc: ReportDoc, meta: ReportMeta): Promise<{ blob: Blob; filename: string }> {
  const children: (Paragraph | Table)[] = [];

  const logo = await loadImage('/gse.png');
  if (logo) {
    const w = 150;
    const h = Math.round((logo.h / logo.w) * w) || 40;
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: dataUrlToBytes(logo.dataUrl), transformation: { width: w, height: h } })] }));
  }
  children.push(new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [new TextRun({ text: 'MARKET & PROCUREMENT REPORT', bold: true, size: 16, color: '40A800' })],
  }));
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '40A800', space: 6 } },
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Energy Market Report', bold: true, size: 40, color: '2B2A2E' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({ text: `Prepared for ${inputs.companyName || inputs.clientName || 'your business'}`, color: '6B6A70', size: 21 }),
      new TextRun({ text: `  ·  ${dateStr()}`, color: '6B6A70', size: 21 }),
    ],
  }));
  const details = detailRows(inputs).filter(([, v]) => v) as [string, string][];
  if (details.length) {
    children.push(docDetailsPanel(details));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  for (const node of exportNodes(doc)) {
    switch (node.type) {
      case 'heading': children.push(docHeadingNode(node)); break;
      case 'paragraph': children.push(new Paragraph({ spacing: { after: 120 }, children: inlineToDocx(node) })); break;
      case 'bulletList': children.push(...docList(node, false)); break;
      case 'orderedList': children.push(...docList(node, true)); break;
      case 'blockquote': children.push(...docBlockquote(node)); break;
      case 'metricsTable': {
        children.push(docMetricsTable((node.attrs?.rows as MetricRow[]) ?? []));
        const asOf = node.attrs?.asOf as string | undefined;
        if (asOf) children.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `Indicative market data, as of ${asOf}.`, italics: true, size: 16, color: '6B6A70' })] }));
        break;
      }
      case 'priceChart': {
        const png = dataUrlToBytes(await svgToPngDataUrl(renderLineChartSVG(priceChartOpts(node.attrs?.chart as ChartData)), 760, 300));
        children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
        break;
      }
      case 'customChart': {
        const d = node.attrs?.data as CustomChartData;
        const png = dataUrlToBytes(await svgToPngDataUrl(renderLineChartSVG(customChartOpts(d)), 760, 300));
        children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
        if (d.caption) children.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: d.caption, italics: true, size: 16, color: '6B6A70' })] }));
        break;
      }
      case 'newsList': {
        for (const it of (node.attrs?.items as NewsRef[]) ?? []) {
          children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: `${it.source}: `, bold: true }), new TextRun({ text: it.title })] }));
        }
        break;
      }
      case 'gridMap': {
        const snap = node.attrs?.snapshot as GridSnapshot | null;
        if (snap?.regions?.length) {
          const svgH = gridMapHeight(GRID_MAP_W);
          const png = dataUrlToBytes(await svgToPngDataUrl(renderGridMapSVG({ regions: snap.regions, mode: (node.attrs?.mode as 'intensity' | 'fuel') ?? 'intensity', width: GRID_MAP_W }), GRID_MAP_W, svgH));
          const w = 360;
          const h = Math.round((svgH / GRID_MAP_W) * w);
          children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h } })] }));
          children.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: gridMapCaption(snap), italics: true, size: 16, color: '6B6A70' })] }));
        }
        break;
      }
      case 'image': {
        const src = node.attrs?.src as string | undefined;
        if (src) {
          const img = await loadImage(src);
          if (img && img.w >= 8 && img.h >= 8) {
            const w = Math.min(540, img.w);
            const h = Math.round((img.h / img.w) * w);
            children.push(new Paragraph({ children: [new ImageRun({ type: img.dataUrl.startsWith('data:image/png') ? 'png' : 'jpg', data: dataUrlToBytes(img.dataUrl), transformation: { width: w, height: h } })] }));
          }
        }
        break;
      }
      default: if (node.content?.length) children.push(new Paragraph({ spacing: { after: 120 }, children: inlineToDocx(node) }));
    }
  }

  children.push(new Paragraph({ spacing: { before: 280, after: 20 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 6 } }, children: [new TextRun({ text: DISCLAIMER, italics: true, size: 15, color: '6B6A70' })] }));
  if (meta.attributions?.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: meta.attributions.join(' '), size: 14, color: '6B6A70' })] }));
  }

  const runningFooter = () => new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 4 } },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [
        new TextRun({ text: 'Green Shift Energy Consulting — indicative information only, not financial advice', size: 14, color: '6B6A70' }),
        new TextRun({ children: ['\t', 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 14, color: '6B6A70' }),
      ],
    })],
  });

  const documentDoc = new Document({
    creator: 'Green Shift Energy — Comms',
    title: 'Energy Market Report',
    numbering: {
      config: [{
        reference: 'report-ol',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }],
      }],
    },
    sections: [{
      properties: { titlePage: true },
      headers: {
        // The cover carries the logo itself; the running header starts on page 2.
        first: new Header({ children: [] }),
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 4 } },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({ text: `Energy Market Report${inputs.companyName ? ` — ${inputs.companyName}` : ''}`, size: 14, color: '6B6A70' }),
              new TextRun({ children: ['\t', dateStr()], size: 14, color: '6B6A70' }),
            ],
          })],
        }),
      },
      footers: { first: runningFooter(), default: runningFooter() },
      children,
    }],
  });
  return { blob: await Packer.toBlob(documentDoc), filename: `${fileBase(inputs)}.docx` };
}
