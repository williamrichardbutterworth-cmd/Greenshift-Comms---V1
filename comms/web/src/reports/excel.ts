import type { ReportState, ComputeResult, ProposedSupplier } from './types';
import { parseNum } from './engine';
import { normalizeCost, supplierLive, recommendedSupplierIndex } from './templates/costComparison';

// A branded, FORMULA-DRIVEN .xlsx mirror of the cost-comparison report, matching the
// Green Shift house format: a "Your current annual cost" block then a green "<Supplier>
// annual cost of energy" block per proposed supplier — one row per meter, day/night split,
// every annual cost a live formula =(dayKwh*dayRate + nightKwh*nightRate + standing*365)/100.
const INK = 'FF2B2A2E';
const GREEN = 'FF40A800';
const GREEN_DARK = 'FF318300';
const GOOD_FILL = 'FFC6EFCE';   // Excel "Good" green (matches the supplied workbook)
const GOOD_FONT = 'FF006100';
const HEAD_FILL = 'FFF2F2F2';   // light grey for the current block header
const LINE = 'FFE7E6E3';

const COST_FMT = '"£"#,##0.00;[Red]\\-"£"#,##0.00';
const KWH_FMT = '#,##0';
const STAND_FMT = '#,##0.00';

export async function buildCostComparisonWorkbook(state: ReportState, computed: ComputeResult): Promise<Blob> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as { default?: typeof import('exceljs') }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Green Shift Energy';
  const ws = wb.addWorksheet('Cost comparison', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 22 }, { width: 18 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 12 }, { width: 15 }, { width: 16 },
  ];

  const v = state.values;
  const cost = normalizeCost(state.data.cost, v.annualKwh);
  const meters = cost.meters;

  const thin = { style: 'thin' as const, color: { argb: LINE } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

  // ── brand logo (graceful if the asset can't be fetched) ──
  try {
    const res = await fetch('/gse.png');
    if (res.ok) {
      const buf = await res.arrayBuffer();
      const imgId = wb.addImage({ buffer: buf as ArrayBuffer, extension: 'png' });
      ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 168, height: 54 } });
    }
  } catch { /* no logo — header text still carries the brand */ }
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 24;

  // ── title + client strip ──
  ws.mergeCells('E1:H1');
  const t = ws.getCell('E1');
  t.value = 'Cost Comparison';
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: INK } };
  t.alignment = { vertical: 'middle', horizontal: 'right' };
  ws.mergeCells('E2:H2');
  const sub = ws.getCell('E2');
  sub.value = (v.reportTitle || 'Electricity Supply Review');
  sub.font = { italic: true, color: { argb: 'FF6C6B70' } };
  sub.alignment = { horizontal: 'right' };

  ws.addRow([]);
  const strip: [string, string, string, string][] = [
    ['Prepared for', v.clientName || '—', 'Issued', v.issueDate || ''],
    ['Total consumption', computed.tokens.totalConsumptionLabel || '—', 'Contract ends', v.contractEndDate || ''],
    ['Meters · sites', `${computed.tokens.meterCount || meters.length} · ${computed.tokens.siteCount || 1}`, 'Report ref', v.reportRef || ''],
  ];
  strip.forEach((r) => {
    const row = ws.addRow([r[0], r[1], '', '', r[2], r[3]]);
    row.getCell(1).font = { color: { argb: 'FF9A999E' }, size: 9 };
    row.getCell(5).font = { color: { argb: 'FF9A999E' }, size: 9 };
    row.getCell(2).font = { bold: true };
    row.getCell(6).font = { bold: true };
  });

  // ── blocks ──
  const recIdx = recommendedSupplierIndex(cost.proposed, meters);
  const currentTotalRef = addBlock('Your current annual cost', HEAD_FILL, INK, meters.map((m) => ({
    meterNumber: m.meterNumber, supplier: m.currentSupplier, dayK: m.dayConsumption, dayR: m.dayRate, nightK: m.nightConsumption, nightR: m.nightRate, standing: m.standing,
  })), false);

  const supplierTotalRefs: { ref: string; rec: boolean }[] = [];
  cost.proposed.forEach((s: ProposedSupplier, i) => {
    if (!supplierLive(s)) return;
    const rec = i === recIdx;
    const ref = addBlock(`${s.name || `Supplier ${i + 1}`} — annual cost of energy${s.term.trim() ? `  ·  ${s.term.trim()}` : ''}${rec ? '   ★ RECOMMENDED' : ''}`, GOOD_FILL, GOOD_FONT, meters.map((m) => ({
      meterNumber: m.meterNumber, supplier: s.name || `Supplier ${i + 1}`, dayK: m.dayConsumption, dayR: s.lines[m.id]?.dayRate ?? '', nightK: m.nightConsumption, nightR: s.lines[m.id]?.nightRate ?? '', standing: s.lines[m.id]?.standing ?? '',
    })), rec);
    supplierTotalRefs.push({ ref, rec });
  });

  // ── saving (recommended vs current) ──
  const recRef = supplierTotalRefs.find((r) => r.rec)?.ref || supplierTotalRefs[0]?.ref;
  ws.addRow([]);
  const savingRow = ws.addRow(['Estimated annual saving (recommended vs current)']);
  ws.mergeCells(`A${savingRow.number}:G${savingRow.number}`);
  savingRow.getCell(1).font = { bold: true, color: { argb: GREEN_DARK }, size: 11 };
  savingRow.getCell(1).alignment = { horizontal: 'right' };
  if (recRef) savingRow.getCell(8).value = { formula: `${currentTotalRef}-${recRef}` };
  savingRow.getCell(8).numFmt = COST_FMT;
  savingRow.getCell(8).font = { bold: true, color: { argb: GREEN_DARK }, size: 12 };
  savingRow.height = 22;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Add one block (merged title → header row → a row per meter with a live cost formula →
  // a total row that SUMs the block). Returns the total cell ref (e.g. "H21").
  function addBlock(
    title: string, titleFill: string, titleFont: string,
    rows: { meterNumber: string; supplier: string; dayK: string; dayR: string; nightK: string; nightR: string; standing: string }[],
    rec: boolean,
  ): string {
    ws.addRow([]);
    const titleRow = ws.addRow([title]);
    ws.mergeCells(`A${titleRow.number}:H${titleRow.number}`);
    titleRow.getCell(1).value = title;
    titleRow.getCell(1).fill = fill(titleFill);
    titleRow.getCell(1).font = { bold: true, size: 11, color: { argb: titleFont } };
    titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    titleRow.height = 20;
    for (let c = 1; c <= 8; c++) titleRow.getCell(c).border = border;

    const headRow = ws.addRow(['Meter number', 'Supplier', 'Annual Day Consumption (kWh)', 'Day Unit Rate (p/kWh)', 'Annual Night Consumption (kWh)', 'Night Unit Rate (p/kWh)', 'Standing Charge (p/day)', 'Annual cost']);
    headRow.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      c.fill = fill(INK);
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = border;
    });
    headRow.height = 30;

    const costRefs: string[] = [];
    rows.forEach((d) => {
      const row = ws.addRow([
        d.meterNumber || '', d.supplier || '',
        numOrBlank(d.dayK), numOrBlank(d.dayR), numOrBlank(d.nightK), numOrBlank(d.nightR), numOrBlank(d.standing), null,
      ]);
      const r = row.number;
      row.getCell(8).value = { formula: `(C${r}*D${r}/100)+(E${r}*F${r}/100)+(G${r}*365/100)` };
      row.getCell(3).numFmt = KWH_FMT; row.getCell(5).numFmt = KWH_FMT;
      row.getCell(7).numFmt = STAND_FMT; row.getCell(8).numFmt = COST_FMT;
      row.getCell(8).font = { bold: true };
      row.eachCell((c) => { c.alignment = { vertical: 'middle', horizontal: 'center' }; c.border = border; });
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
      if (rec) row.eachCell((c) => { c.fill = fill('FFF4FBEF'); });
      costRefs.push(`H${r}`);
    });

    const totalRow = ws.addRow(['Total annual cost']);
    ws.mergeCells(`A${totalRow.number}:G${totalRow.number}`);
    totalRow.getCell(1).font = { bold: true, color: { argb: rec ? GREEN_DARK : INK } };
    totalRow.getCell(1).alignment = { horizontal: 'right' };
    totalRow.getCell(8).value = costRefs.length ? { formula: `SUM(${costRefs[0]}:${costRefs[costRefs.length - 1]})` } : 0;
    totalRow.getCell(8).numFmt = COST_FMT;
    totalRow.getCell(8).font = { bold: true, color: { argb: rec ? GREEN_DARK : INK } };
    for (let c = 1; c <= 8; c++) totalRow.getCell(c).border = border;
    return `H${totalRow.number}`;
  }

  function numOrBlank(s: string): number | null {
    const n = parseNum(s);
    return Number.isFinite(n) && s.trim() !== '' ? n : null;
  }
}
