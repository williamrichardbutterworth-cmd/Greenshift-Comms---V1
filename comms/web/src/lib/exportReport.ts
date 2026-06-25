import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, LevelFormat, Header, Footer, PageNumber, ShadingType,
  TabStopType, TabStopPosition,
} from 'docx';
import { renderLineChartSVG, type ChartOptions } from './chartSvg';
import { renderGridMapSVG, gridMapHeight } from './gridMapSvg';
import { analyzeCurve, procurementNarrative, forwardCurveChartOptions, commodityLabel, legValue } from './forwardCurve';
import { inlineRuns, plainText, hasMarks, pdfFontStyle, inlineToDocx } from './serializeDoc';
import type { ReportDoc, DocNode, ReportInputs, ReportMeta, MetricRow, ChartData, NewsRef, CustomChartData, GridSnapshot, ForwardCurveSnapshot, CommodityCurve, CurveLeg, KpiStripData, ComparisonTableData, RecommendationBoxData } from './api';

// Branded client-side report export — no server, no Puppeteer. Walks the TipTap
// document (headings, rich paragraphs, lists, quotes + the embedded metrics /
// chart / custom-chart / news blocks) and renders it to PDF (jsPDF) and Word
// (docx). Charts are rasterised from SVG → PNG via a canvas. The header, footer,
// disclaimer and source attribution are unchanged from the original exporter.

const DISCLAIMER_BASE =
  'This report is for general information only and does not constitute a price quotation or financial advice, nor a personal recommendation to buy or sell. Market figures are indicative. Green Shift Energy Consulting.';
// Extra disclaimers injected per report kind (always added — the agent can't remove them).
const DISCLAIMER_EXTRA: Record<string, string[]> = {
  'procure-ahead': ['Forward prices are indicative market levels and are not a reliable indicator of future prices; the read is based on the shape of the curve at the stated snapshot time.'],
  renewal: ['Any saving depends on your actual consumption and the contract ultimately secured. Indicative levels only.'],
  'ooc-warning': ['Deemed / out-of-contract rate comparisons are illustrative; your actual rates depend on your supplier and meter type.'],
  tender: ['Green Shift Energy acts as a third-party intermediary and may receive a commission or fee from the supplier, which is reflected in the rates and disclosed in the supplier’s contract. Comparison figures are indicative and exclude VAT unless stated.'],
  'market-update': ['General market commentary only, not a personal recommendation.'],
};
const disclaimerSet = (kind?: string): string[] => [DISCLAIMER_BASE, ...(kind && DISCLAIMER_EXTRA[kind] ? DISCLAIMER_EXTRA[kind] : [])];

// Report identity for the cover/letterhead, with the market-report defaults.
function reportIdentity(meta: ReportMeta): { title: string; subtitle?: string } {
  return { title: meta.reportTitle?.trim() || 'Energy Market Report', subtitle: meta.reportSubtitle?.trim() || undefined };
}
const dateStr = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const asAt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

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
// A data block that never resolved (or was inserted empty) renders nothing —
// drop it together with the heading that solely introduces it, so the export
// has no orphan headings or stray captions.
function isEmptyEmbed(n: DocNode): boolean {
  const a = n.attrs as { snapshot?: unknown; data?: { cards?: unknown[]; rows?: { option?: string }[] } } | undefined;
  if (n.type === 'gridMap' || n.type === 'forwardCurve') return !a?.snapshot;
  if (n.type === 'kpiStrip') return !(a?.data?.cards?.length);
  if (n.type === 'comparisonTable') return !((a?.data?.rows ?? []).some((r) => (r.option ?? '').trim()));
  return false;
}
function exportNodes(doc: ReportDoc): DocNode[] {
  const ns = nodes(doc);
  const out: DocNode[] = [];
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    if (isEmptyEmbed(n)) {
      const prev = ns[i - 1];
      if (prev && prev.type === 'heading' && out[out.length - 1] === prev) out.pop();
      continue;
    }
    out.push(n);
  }
  return out;
}

// The disclaimer set: the report-kind set, UNION any caveat required by a data
// block actually present (so a forward curve always carries the not-a-forecast
// caveat and a comparison table always carries the commission disclosure,
// regardless of the template's reportKind).
function allDisclaimers(doc: ReportDoc, kind?: string): string[] {
  const set = new Set(disclaimerSet(kind));
  const types = new Set((doc.content ?? []).map((n) => n.type));
  if (types.has('forwardCurve') || types.has('kpiStrip')) DISCLAIMER_EXTRA['procure-ahead'].forEach((d) => set.add(d));
  if (types.has('comparisonTable')) DISCLAIMER_EXTRA.tender.forEach((d) => set.add(d));
  return [...set];
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
  let fig = 0;

  // Reserve room for the running footer; continuation pages start below the
  // running header (both drawn in a post-pass once the page count is known).
  const FOOTER_H = 34;
  const ensure = (need: number) => { if (y + need > H - M - FOOTER_H) { pdf.addPage(); y = M + 14; } };

  // — Branded cover header (identity is dynamic per report kind) —
  const ident = reportIdentity(meta);
  const logo = await loadImage('/gse.png');
  if (logo) pdf.addImage(logo.dataUrl, 'PNG', M, y, 110, (logo.h / logo.w) * 110, undefined, 'FAST');
  pdf.setFontSize(9).setTextColor(...RGB.muted);
  pdf.text(dateStr(), W - M, y + 8, { align: 'right' });
  if (meta.asOf) pdf.setFontSize(7.5).text(`Prices as at ${asAt(meta.asOf)}`, W - M, y + 19, { align: 'right' });
  y += 42;
  pdf.setDrawColor(...RGB.green).setLineWidth(2).line(M, y, W - M, y);
  y += 26;
  pdf.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...RGB.ink);
  for (const ln of pdf.splitTextToSize(ident.title, cW)) { pdf.text(ln, M, y); y += 24; }
  y -= 7;
  if (ident.subtitle) {
    y += 4;
    pdf.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...RGB.greenDark).text(ident.subtitle, M, y);
    y += 16;
  }
  pdf.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...RGB.muted)
    .text('Prepared for ' + (inputs.companyName || inputs.clientName || 'your business') + '  ·  Green Shift Energy', M, y);
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

  const pdfForwardCurve = async (snap: ForwardCurveSnapshot | null) => {
    if (!snap?.curves?.length) return;
    for (const curve of snap.curves) {
      const a = analyzeCurve(curve);
      ensure(14);
      pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...RGB.ink).text(`${commodityLabel(curve.commodity)} (${curve.unit})`, M, y); y += 14;
      if (a) {
        pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
        for (const ln of pdf.splitTextToSize(procurementNarrative(curve, a), cW)) { ensure(lineH); pdf.text(ln, M, y); y += lineH; }
        y += 3;
      }
      await pdfChartImage(forwardCurveChartOptions(curve, { width: 760, height: 300 }));
      autoTable(pdf, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Contract', 'Latest', 'Current']],
        body: curve.legs.map((l) => [l.label, l.latest ?? '—', l.current ?? legValue(l) ?? '—']),
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 3, lineColor: RGB.line, textColor: RGB.ink },
        headStyles: { fillColor: [244, 250, 239], textColor: RGB.greenDark, fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        didParseCell: (d) => { if (d.section === 'body' && a && a.hasForwardValue && curve.legs[d.row.index] === a.cheapest) d.cell.styles.textColor = RGB.down; },
      });
      y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
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

  // Auto-numbered "Figure N. Source: … Data as at …" caption under a figure.
  const pdfFigureCaption = (source: string, dateIso?: string | null) => {
    fig += 1;
    const when = dateIso === null ? '' : (dateIso ? asAt(dateIso) : (meta.asOf ? asAt(meta.asOf) : ''));
    const cap = `Figure ${fig}. Source: ${source}.${when ? ` Data as at ${when}.` : ''}`;
    pdf.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...RGB.muted);
    for (const ln of pdf.splitTextToSize(cap, cW)) { ensure(10); pdf.text(ln, M, y); y += 10; }
    y += 2;
  };

  const pdfKpiStrip = (data: KpiStripData) => {
    const cards = data.cards ?? [];
    if (!cards.length) return;
    const gap = 8;
    const cardW = (cW - gap * (cards.length - 1)) / cards.length;
    const cardH = 50;
    ensure(cardH + 6);
    cards.forEach((c, i) => {
      const cx = M + i * (cardW + gap);
      const accent = c.tone === 'accent';
      if (accent) { pdf.setFillColor(244, 250, 239); pdf.setDrawColor(...RGB.green); } else { pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...RGB.line); }
      pdf.setLineWidth(0.7).roundedRect(cx, y, cardW, cardH, 4, 4, 'FD');
      pdf.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(...RGB.muted);
      pdf.text(pdf.splitTextToSize(c.label.toUpperCase(), cardW - 12).slice(0, 2), cx + 6, y + 12);
      pdf.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...(accent ? RGB.greenDark : RGB.ink));
      pdf.text(String(c.value), cx + 6, y + 33);
      pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...RGB.muted);
      const sub = [c.unit, c.delta != null ? `${c.delta > 0 ? '+' : ''}${c.delta}%` : ''].filter(Boolean).join('  ');
      if (sub) pdf.text(sub.slice(0, 28), cx + 6, y + 44);
    });
    y += cardH + 4;
    pdfFigureCaption('Indicative UK market benchmarks' + (data.note ? `; ${data.note}` : ''));
  };

  const pdfRecommendation = (data: RecommendationBoxData) => {
    const text = (data?.text ?? '').trim();
    if (!text) return;
    const label = (data?.label || 'Our recommendation').toUpperCase();
    const innerW = cW - 22;
    pdf.setFont('helvetica', 'normal').setFontSize(10);
    const lines = pdf.splitTextToSize(text, innerW);
    const boxH = 22 + lines.length * 13 + 8;
    // A single fixed-height rect can't page-break; for an unusually long verdict,
    // fall back to a flowing label + paragraph (per-line ensure handles breaks).
    if (boxH > H - M * 2 - FOOTER_H) {
      ensure(20);
      pdf.setFillColor(...RGB.green).rect(M, y - 8.5, 3, 11, 'F');
      pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...RGB.greenDark).text(label, M + 9, y); y += 14;
      pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
      for (const ln of lines) { ensure(13); pdf.text(ln, M + 9, y); y += 13; }
      y += 6;
      return;
    }
    ensure(boxH + 4);
    pdf.setFillColor(244, 250, 239).setDrawColor(...RGB.green).setLineWidth(0).rect(M, y, cW, boxH, 'F');
    pdf.setFillColor(...RGB.green).rect(M, y, 4, boxH, 'F');
    pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...RGB.greenDark).text(label, M + 14, y + 15);
    pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
    let ty = y + 30;
    for (const ln of lines) { pdf.text(ln, M + 14, ty); ty += 13; }
    y += boxH + 8;
  };

  const pdfComparison = (data: ComparisonTableData) => {
    const rows = (data?.rows ?? []).filter((r) => (r.option ?? '').trim());
    if (!rows.length) return;
    const recIdx = rows.findIndex((r) => r.recommended);
    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Option', 'Unit rate', 'Standing', 'Term', 'Annual cost', 'Green', '']],
      body: rows.map((r) => [r.option, r.unitRate || '—', r.standingCharge || '—', r.term || '—', r.annualCost || '—', r.green ? 'Yes' : '—', r.recommended ? 'Recommended' : '']),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 4, lineColor: RGB.line, textColor: RGB.ink },
      headStyles: { fillColor: [244, 250, 239], textColor: RGB.greenDark, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'center', textColor: RGB.greenDark, fontStyle: 'bold' } },
      didParseCell: (d) => { if (d.section === 'body' && recIdx >= 0 && d.row.index === recIdx) d.cell.styles.fillColor = [244, 250, 239]; },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    pdfFigureCaption(`Supplier quotes compiled by Green Shift Energy — indicative, may exclude VAT; Green Shift acts as a third-party intermediary and may earn a commission${(data?.caption ?? '').trim() ? `. ${data.caption!.trim()}` : ''}`, null);
  };

  for (const node of exportNodes(doc)) {
    switch (node.type) {
      case 'heading': pdfHeading(node); break;
      case 'paragraph': pdfParagraph(node); break;
      case 'bulletList': pdfList(node, false); break;
      case 'orderedList': pdfList(node, true); break;
      case 'blockquote': pdfBlockquote(node); break;
      case 'metricsTable': { const rows = (node.attrs?.rows as MetricRow[]) ?? []; if (rows.length) { pdfMetrics(node); pdfFigureCaption('Indicative UK market benchmarks', node.attrs?.asOf as string | undefined); } break; }
      case 'priceChart': { const c = node.attrs?.chart as ChartData; if (c?.points?.length) { await pdfChartImage(priceChartOpts(c)); pdfFigureCaption(c?.sourceName || c?.label || 'Market price history'); } break; }
      case 'customChart': {
        const d = node.attrs?.data as CustomChartData;
        if (d?.points?.length) { await pdfChartImage(customChartOpts(d), d.caption); pdfFigureCaption(d?.sourceName || 'Green Shift Energy analysis'); }
        break;
      }
      case 'newsList': pdfNews((node.attrs?.items as NewsRef[]) ?? []); break;
      case 'gridMap': { const gs = node.attrs?.snapshot as GridSnapshot | null; if (gs?.regions?.length) { await pdfGridMap(gs, (node.attrs?.mode as 'intensity' | 'fuel') ?? 'intensity'); pdfFigureCaption('NESO Carbon Intensity (CC BY 4.0) & Elexon (BMRS)'); } break; }
      case 'forwardCurve': { const fs = node.attrs?.snapshot as ForwardCurveSnapshot | null; await pdfForwardCurve(fs); if (fs?.curves?.length) pdfFigureCaption(`${fs.source} — forward snapshot; indicative forward levels, not a reliable indicator of future prices`, fs.asOfDate); break; }
      case 'kpiStrip': pdfKpiStrip(node.attrs?.data as KpiStripData); break;
      case 'recommendationBox': pdfRecommendation(node.attrs?.data as RecommendationBoxData); break;
      case 'comparisonTable': pdfComparison(node.attrs?.data as ComparisonTableData); break;
      case 'image': await pdfImage(node); break;
      default: if (node.content?.length) pdfParagraph(node);
    }
    y += 6;
  }

  // — Sources & methodology, then the per-report-kind disclaimer set —
  ensure(54);
  y += 8;
  pdf.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, y, W - M, y);
  y += 13;
  pdf.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...RGB.greenDark).text('SOURCES & METHODOLOGY', M, y);
  y += 12;
  pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...RGB.muted);
  if (meta.asOf) { for (const ln of pdf.splitTextToSize(`Market data as at ${asAt(meta.asOf)}. Report generated ${dateStr()}.`, cW)) { ensure(10); pdf.text(ln, M, y); y += 10; } }
  if (meta.attributions?.length) for (const ln of pdf.splitTextToSize(meta.attributions.join(' '), cW)) { ensure(10); pdf.text(ln, M, y); y += 10; }
  y += 4;
  pdf.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(...RGB.muted);
  for (const d of allDisclaimers(doc, meta.reportKind)) {
    for (const ln of pdf.splitTextToSize(d, cW)) { ensure(10); pdf.text(ln, M, y); y += 10; }
    y += 2;
  }

  // — Running header (pages 2+) and footer with page numbers (all pages) —
  const pageCount = pdf.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    if (i > 1) {
      pdf.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...RGB.muted);
      pdf.text(ident.title + (inputs.companyName ? ` — ${inputs.companyName}` : ''), M, 30);
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

// Forward-curve season table for the Word export — Contract / Latest / Current,
// with the cheapest forward term highlighted green.
function docForwardCurveTable(curve: CommodityCurve, cheapest: CurveLeg | null): Table {
  const cell = (text: string, align?: (typeof AlignmentType)[keyof typeof AlignmentType], color?: string, bold?: boolean) =>
    new TableCell({
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
      },
      margins: { top: 30, bottom: 30, left: 60, right: 60 },
      children: [new Paragraph({ alignment: align, children: [new TextRun({ text, color, bold, size: 18 })] })],
    });
  const head = new TableRow({
    children: [
      cell('Contract', AlignmentType.LEFT, '318300', true),
      cell('Latest', AlignmentType.RIGHT, '318300', true),
      cell('Current', AlignmentType.RIGHT, '318300', true),
    ],
  });
  const rows = curve.legs.map((l) => {
    const hot = l === cheapest;
    const color = hot ? '2E7D32' : undefined;
    return new TableRow({
      children: [
        cell(l.label, AlignmentType.LEFT, color, hot),
        cell(l.latest == null ? '—' : String(l.latest), AlignmentType.RIGHT, color),
        cell(l.current == null ? (l.latest == null ? '—' : String(l.latest)) : String(l.current), AlignmentType.RIGHT, color),
      ],
    });
  });
  return new Table({ width: { size: 70, type: WidthType.PERCENTAGE }, rows: [head, ...rows] });
}

// KPI "at a glance" strip → a single-row table of bordered cards.
function docKpiStrip(data: KpiStripData): Table {
  const cards = (data.cards ?? []).slice(0, 4);
  const cell = (c: KpiStripData['cards'][number]) => new TableCell({
    width: { size: Math.floor(100 / cards.length), type: WidthType.PERCENTAGE },
    shading: c.tone === 'accent' ? { type: ShadingType.CLEAR, fill: 'F4FAEF', color: 'auto' } : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: c.tone === 'accent' ? '40A800' : 'E7E8E6' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: c.tone === 'accent' ? '40A800' : 'E7E8E6' },
      left: { style: BorderStyle.SINGLE, size: 4, color: c.tone === 'accent' ? '40A800' : 'E7E8E6' },
      right: { style: BorderStyle.SINGLE, size: 4, color: c.tone === 'accent' ? '40A800' : 'E7E8E6' },
    },
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [
      new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: c.label.toUpperCase(), bold: true, size: 12, color: '6B6A70' })] }),
      new Paragraph({ spacing: { after: 10 }, children: [new TextRun({ text: String(c.value), bold: true, size: 30, color: c.tone === 'accent' ? '318300' : '2B2A2E' })] }),
      new Paragraph({ children: [new TextRun({ text: [c.unit, c.delta != null ? `${c.delta > 0 ? '+' : ''}${c.delta}%` : ''].filter(Boolean).join('   '), size: 14, color: '6B6A70' })] }),
    ],
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cards.map(cell) })] });
}

// Recommendation verdict → a tinted single-cell table with a green left rule.
function docRecommendationBox(data: RecommendationBoxData): Table {
  const text = (data?.text ?? '').trim();
  const label = (data?.label || 'Our recommendation').toUpperCase();
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'F4FAEF', color: 'auto' },
      borders: {
        left: { style: BorderStyle.SINGLE, size: 18, color: '40A800' },
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label, bold: true, size: 16, color: '318300' })] }),
        new Paragraph({ children: [new TextRun({ text, size: 20, color: '2B2A2E' })] }),
      ],
    })] })],
  });
}

// Supplier / scenario comparison → a table with the recommended row tinted.
function docComparisonTable(data: ComparisonTableData): Table {
  const rows = (data?.rows ?? []).filter((r) => (r.option ?? '').trim());
  const headLabels = ['Option', 'Unit rate', 'Standing', 'Term', 'Annual cost', 'Green', ''];
  const cell = (text: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; color?: string; fill?: string } = {}) =>
    new TableCell({
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6' },
      },
      margins: { top: 30, bottom: 30, left: 60, right: 60 },
      children: [new Paragraph({ alignment: opts.align, children: [new TextRun({ text, bold: opts.bold, size: 18, color: opts.color })] })],
    });
  const head = new TableRow({ children: headLabels.map((h, i) => cell(h, { bold: true, color: '318300', align: i >= 1 && i <= 4 ? AlignmentType.RIGHT : undefined })) });
  const body = rows.map((r) => {
    const fill = r.recommended ? 'F4FAEF' : undefined;
    return new TableRow({ children: [
      cell(r.option, { bold: r.recommended, fill }),
      cell(r.unitRate || '—', { align: AlignmentType.RIGHT, fill }),
      cell(r.standingCharge || '—', { align: AlignmentType.RIGHT, fill }),
      cell(r.term || '—', { align: AlignmentType.RIGHT, fill }),
      cell(r.annualCost || '—', { align: AlignmentType.RIGHT, fill }),
      cell(r.green ? 'Yes' : '—', { align: AlignmentType.CENTER, fill }),
      cell(r.recommended ? 'Recommended' : '', { bold: true, color: '318300', align: AlignmentType.CENTER, fill }),
    ] });
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] });
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
  const ident = reportIdentity(meta);
  children.push(new Paragraph({
    spacing: { before: 160, after: 40 },
    children: [new TextRun({ text: 'GREEN SHIFT ENERGY', bold: true, size: 16, color: '40A800' })],
  }));
  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '40A800', space: 6 } },
    spacing: { after: ident.subtitle ? 40 : 80 },
    children: [new TextRun({ text: ident.title, bold: true, size: 40, color: '2B2A2E' })],
  }));
  if (ident.subtitle) {
    children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: ident.subtitle, size: 24, color: '318300' })] }));
  }
  children.push(new Paragraph({
    spacing: { after: meta.asOf ? 40 : 200 },
    children: [
      new TextRun({ text: `Prepared for ${inputs.companyName || inputs.clientName || 'your business'}`, color: '6B6A70', size: 21 }),
      new TextRun({ text: `  ·  Green Shift Energy  ·  ${dateStr()}`, color: '6B6A70', size: 21 }),
    ],
  }));
  if (meta.asOf) {
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `Prices as at ${asAt(meta.asOf)}`, color: '6B6A70', size: 16, italics: true })] }));
  }
  const details = detailRows(inputs).filter(([, v]) => v) as [string, string][];
  if (details.length) {
    children.push(docDetailsPanel(details));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  let fig = 0;
  const docFig = (source: string, dateIso?: string | null) => {
    fig += 1;
    const when = dateIso === null ? '' : (dateIso ? asAt(dateIso) : (meta.asOf ? asAt(meta.asOf) : ''));
    return new Paragraph({ spacing: { before: 40, after: 100 }, children: [new TextRun({ text: `Figure ${fig}. Source: ${source}.${when ? ` Data as at ${when}.` : ''}`, italics: true, size: 15, color: '6B6A70' })] });
  };

  for (const node of exportNodes(doc)) {
    switch (node.type) {
      case 'heading': children.push(docHeadingNode(node)); break;
      case 'paragraph': children.push(new Paragraph({ spacing: { after: 120 }, children: inlineToDocx(node) })); break;
      case 'bulletList': children.push(...docList(node, false)); break;
      case 'orderedList': children.push(...docList(node, true)); break;
      case 'blockquote': children.push(...docBlockquote(node)); break;
      case 'metricsTable': {
        const rows = (node.attrs?.rows as MetricRow[]) ?? [];
        if (rows.length) { children.push(docMetricsTable(rows)); children.push(docFig('Indicative UK market benchmarks', node.attrs?.asOf as string | undefined)); }
        break;
      }
      case 'kpiStrip': {
        const data = node.attrs?.data as KpiStripData;
        if (data?.cards?.length) { children.push(docKpiStrip(data)); children.push(docFig('Indicative UK market benchmarks' + (data.note ? `; ${data.note}` : ''))); }
        break;
      }
      case 'recommendationBox': {
        const data = node.attrs?.data as RecommendationBoxData;
        if ((data?.text ?? '').trim()) children.push(docRecommendationBox(data));
        break;
      }
      case 'comparisonTable': {
        const data = node.attrs?.data as ComparisonTableData;
        const rows = (data?.rows ?? []).filter((r) => (r.option ?? '').trim());
        if (rows.length) { children.push(docComparisonTable(data)); children.push(docFig(`Supplier quotes compiled by Green Shift Energy — indicative, may exclude VAT; Green Shift acts as a third-party intermediary and may earn a commission${(data?.caption ?? '').trim() ? `. ${data.caption!.trim()}` : ''}`, null)); }
        break;
      }
      case 'priceChart': {
        const c = node.attrs?.chart as ChartData;
        if (c?.points?.length) {
          const png = dataUrlToBytes(await svgToPngDataUrl(renderLineChartSVG(priceChartOpts(c)), 760, 300));
          children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
          children.push(docFig(c?.sourceName || c?.label || 'Market price history'));
        }
        break;
      }
      case 'customChart': {
        const d = node.attrs?.data as CustomChartData;
        if (d?.points?.length) {
          const png = dataUrlToBytes(await svgToPngDataUrl(renderLineChartSVG(customChartOpts(d)), 760, 300));
          children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
          if (d.caption) children.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: d.caption, italics: true, size: 16, color: '6B6A70' })] }));
          children.push(docFig(d?.sourceName || 'Green Shift Energy analysis'));
        }
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
          children.push(docFig('NESO Carbon Intensity (CC BY 4.0) & Elexon (BMRS)'));
        }
        break;
      }
      case 'forwardCurve': {
        const snap = node.attrs?.snapshot as ForwardCurveSnapshot | null;
        for (const curve of snap?.curves ?? []) {
          const a = analyzeCurve(curve);
          children.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: `${commodityLabel(curve.commodity)} (${curve.unit})`, bold: true, size: 22, color: '2B2A2E' })] }));
          if (a) children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: procurementNarrative(curve, a), size: 20 })] }));
          const png = dataUrlToBytes(await svgToPngDataUrl(renderLineChartSVG(forwardCurveChartOptions(curve, { width: 760, height: 300 })), 760, 300));
          children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
          children.push(docForwardCurveTable(curve, a && a.hasForwardValue ? a.cheapest : null));
        }
        if (snap?.curves?.length) children.push(docFig(`${snap.source} — forward snapshot; indicative forward levels, not a reliable indicator of future prices`, snap.asOfDate));
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

  children.push(new Paragraph({ spacing: { before: 280, after: 40 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 6 } }, children: [new TextRun({ text: 'SOURCES & METHODOLOGY', bold: true, size: 16, color: '318300' })] }));
  if (meta.asOf) children.push(new Paragraph({ children: [new TextRun({ text: `Market data as at ${asAt(meta.asOf)}. Report generated ${dateStr()}.`, size: 14, color: '6B6A70' })] }));
  if (meta.attributions?.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: meta.attributions.join(' '), size: 14, color: '6B6A70' })] }));
  }
  for (const d of allDisclaimers(doc, meta.reportKind)) {
    children.push(new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: d, italics: true, size: 14, color: '6B6A70' })] }));
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
              new TextRun({ text: `${ident.title}${inputs.companyName ? ` — ${inputs.companyName}` : ''}`, size: 14, color: '6B6A70' }),
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
