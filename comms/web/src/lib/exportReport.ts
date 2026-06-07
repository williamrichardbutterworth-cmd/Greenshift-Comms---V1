import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } from 'docx';
import { renderLineChartSVG } from './chartSvg';
import type { ReportBlock, ReportInputs, ReportMeta, MetricRow } from './api';

// Branded client-side report export — no server, no Puppeteer. Runs entirely in
// the browser so it works on any host (incl. Vercel serverless). PDF via jsPDF,
// Word via docx; price charts are rasterised from SVG to PNG via a canvas.

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

const chartSvgFor = (b: Extract<ReportBlock, { type: 'chart' }>) =>
  renderLineChartSVG({ points: b.chart.points, title: b.chart.label, unit: b.chart.unit, source: b.chart.sourceName, width: 760, height: 300 });

const fileBase = (inputs: ReportInputs) => (inputs.companyName || 'energy-report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

// ───────────────────────── PDF (jsPDF) ─────────────────────────

export async function exportReportPdf(inputs: ReportInputs, blocks: ReportBlock[], meta: ReportMeta): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const cW = W - M * 2;
  let y = M;

  const ensure = (need: number) => { if (y + need > H - M) { doc.addPage(); y = M; } };

  const logo = await loadImage('/gse.png');
  if (logo) doc.addImage(logo.dataUrl, 'PNG', M, y, 110, (logo.h / logo.w) * 110, undefined, 'FAST');
  doc.setFontSize(9).setTextColor(...RGB.muted);
  doc.text('Market & Procurement Report', W - M, y + 8, { align: 'right' });
  doc.text(dateStr(), W - M, y + 20, { align: 'right' });
  y += 42;
  doc.setDrawColor(...RGB.green).setLineWidth(2).line(M, y, W - M, y);
  y += 22;
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...RGB.ink).text('Energy Market Report', M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.muted)
    .text('Prepared for ' + (inputs.companyName || inputs.clientName || 'your business'), M, y);
  y += 20;

  doc.setFontSize(9);
  for (const [k, v] of detailRows(inputs)) {
    if (!v) continue;
    ensure(14);
    doc.setFont('helvetica', 'bold').setTextColor(...RGB.muted).text(`${k}: `, M, y);
    const kw = doc.getTextWidth(`${k}: `);
    doc.setFont('helvetica', 'normal').setTextColor(...RGB.ink).text(v, M + kw, y);
    y += 13;
  }
  y += 10;

  const heading = (text: string) => {
    ensure(26);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...RGB.greenDark).text(text.toUpperCase(), M, y);
    y += 5;
    doc.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, y, W - M, y);
    y += 12;
  };

  const paragraphs = (body: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
    for (const para of (body || '').split(/\n{2,}/).filter((p) => p.trim())) {
      for (const line of doc.splitTextToSize(para, cW)) {
        ensure(13);
        doc.text(line, M, y);
        y += 13;
      }
      y += 5;
    }
  };

  for (const b of blocks) {
    heading(b.heading);
    if (b.type === 'text') {
      paragraphs(b.body);
    } else if (b.type === 'metrics') {
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Metric', 'Value', 'Change']],
        body: b.rows.map((r: MetricRow) => [
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
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      if (b.asOf) { ensure(12); doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...RGB.muted).text(`Indicative market data, as of ${b.asOf}.`, M, y); y += 12; }
    } else if (b.type === 'chart') {
      const imgH = (cW * 300) / 760;
      ensure(imgH + 6);
      const png = await svgToPngDataUrl(chartSvgFor(b), 760, 300);
      doc.addImage(png, 'PNG', M, y, cW, imgH, undefined, 'MEDIUM');
      y += imgH + 6;
    } else if (b.type === 'news') {
      doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...RGB.ink);
      for (const it of b.items) {
        for (const line of doc.splitTextToSize(`•  ${it.source}: ${it.title}`, cW)) {
          ensure(13);
          doc.text(line, M, y);
          y += 13;
        }
      }
    }
    y += 8;
  }

  // Footer disclaimer at the bottom of the final page.
  ensure(64);
  const fy = H - 52;
  doc.setDrawColor(...RGB.line).setLineWidth(0.5).line(M, fy - 8, W - M, fy - 8);
  doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(...RGB.muted);
  doc.text(doc.splitTextToSize(DISCLAIMER, cW), M, fy);
  if (meta.attributions?.length) {
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(meta.attributions.join(' '), cW), M, fy + 18);
  }

  return { blob: doc.output('blob'), filename: `${fileBase(inputs)}.pdf` };
}

// ───────────────────────── Word (docx) ─────────────────────────

function docHeading(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 240, after: 80 }, children: [new TextRun({ text: text.toUpperCase(), bold: true, color: '318300', size: 22 })] });
}
function docBody(body: string): Paragraph[] {
  return (body || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => {
    const lines = p.split(/\n/);
    return new Paragraph({ spacing: { after: 120 }, children: lines.map((ln, i) => (i === 0 ? new TextRun({ text: ln }) : new TextRun({ text: ln, break: 1 }))) });
  });
}
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

export async function exportReportDocx(inputs: ReportInputs, blocks: ReportBlock[], meta: ReportMeta): Promise<{ blob: Blob; filename: string }> {
  const children: (Paragraph | Table)[] = [];

  const logo = await loadImage('/gse.png');
  if (logo) {
    const w = 150;
    const h = Math.round((logo.h / logo.w) * w) || 40;
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: dataUrlToBytes(logo.dataUrl), transformation: { width: w, height: h } })] }));
  }
  children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Energy Market Report', bold: true, size: 34, color: '2B2A2E' })] }));
  children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `Prepared for ${inputs.companyName || inputs.clientName || 'your business'}`, color: '6B6A70', size: 20 })] }));
  for (const [k, v] of detailRows(inputs)) {
    if (!v) continue;
    children.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${k}: `, bold: true, size: 18, color: '6B6A70' }), new TextRun({ text: v, size: 18 })] }));
  }

  for (const b of blocks) {
    children.push(docHeading(b.heading));
    if (b.type === 'text') {
      children.push(...docBody(b.body));
    } else if (b.type === 'metrics') {
      children.push(docMetricsTable(b.rows));
      if (b.asOf) children.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: `Indicative market data, as of ${b.asOf}.`, italics: true, size: 16, color: '6B6A70' })] }));
    } else if (b.type === 'chart') {
      const png = dataUrlToBytes(await svgToPngDataUrl(chartSvgFor(b), 760, 300));
      children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: 600, height: 237 } })] }));
    } else if (b.type === 'news') {
      for (const it of b.items) {
        children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: `${it.source}: `, bold: true }), new TextRun({ text: it.title })] }));
      }
    }
  }

  children.push(new Paragraph({ spacing: { before: 280, after: 20 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'E7E8E6', space: 6 } }, children: [new TextRun({ text: DISCLAIMER, italics: true, size: 15, color: '6B6A70' })] }));
  if (meta.attributions?.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: meta.attributions.join(' '), size: 14, color: '6B6A70' })] }));
  }

  const doc = new Document({ creator: 'Green Shift Energy — Comms', title: 'Energy Market Report', sections: [{ children }] });
  return { blob: await Packer.toBlob(doc), filename: `${fileBase(inputs)}.docx` };
}
