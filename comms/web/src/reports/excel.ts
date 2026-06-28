import type { ReportState, ComputeResult } from './types';
import { parseNum } from './engine';

// A branded, FORMULA-DRIVEN .xlsx mirror of the cost-comparison report: change the
// kWh or a rate and every annual cost / saving recalculates in Excel. Styled to GSE.
const INK = 'FF2B2A2E';
const GREEN = 'FF40A800';
const GREEN_DARK = 'FF318300';
const TINT = 'FFEAF5E0';
const LINE = 'FFE7E6E3';

export async function buildCostComparisonWorkbook(state: ReportState, computed: ComputeResult): Promise<Blob> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as { default?: typeof import('exceljs') }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Green Shift Energy';
  const ws = wb.addWorksheet('Cost comparison', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 34 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
  ];

  const v = state.values;
  const cost = state.data.cost ?? { current: { supplier: '', product: '', unitRate: '', standing: '', termStatus: '' }, quotes: [] };
  const kwh = parseNum(v.annualKwh) || 0;

  const thin = { style: 'thin' as const, color: { argb: LINE } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
  const moneyFmt = '"£"#,##0';
  const rateFmt = '0.00';

  // ── Title ──
  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = 'Green Shift Energy — Cost Comparison';
  t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  t.fill = fill(GREEN);
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 28;
  ws.mergeCells('A2:F2');
  const sub = ws.getCell('A2');
  sub.value = (v.reportTitle || 'Electricity Supply Review') + '  ·  Cost Comparison & Recommendation';
  sub.font = { italic: true, color: { argb: 'FF6C6B70' } };

  // ── Client strip ──
  ws.addRow([]);
  const strip = [
    ['Prepared for', v.clientName || '—', 'Issued', v.issueDate || ''],
    ['Annual consumption (kWh)', kwh || '', 'Contract ends', v.contractEndDate || ''],
    ['Consultant', v.consultantName || '—', 'Report ref', v.reportRef || ''],
  ];
  strip.forEach((r) => {
    const row = ws.addRow(r);
    row.getCell(1).font = { color: { argb: 'FF9A999E' }, size: 9 };
    row.getCell(3).font = { color: { argb: 'FF9A999E' }, size: 9 };
    row.getCell(2).font = { bold: true };
    row.getCell(4).font = { bold: true };
  });
  const kwhCellRef = `B${ws.rowCount - 1}`; // the "Annual consumption" value cell

  // ── Current position ──
  ws.addRow([]);
  sectionHeader(ws, 'YOUR CURRENT POSITION');
  tableHeader(ws, ['Supplier & product', 'Unit rate (p/kWh)', 'Standing (p/day)', 'Contract status', 'Annual cost (£)']);
  const curRow = ws.addRow([
    [cost.current.supplier, cost.current.product].filter(Boolean).join(' — ') || '—',
    parseNum(cost.current.unitRate) || null,
    parseNum(cost.current.standing) || null,
    cost.current.termStatus || '',
    null,
  ]);
  const curR = curRow.number;
  curRow.getCell(5).value = { formula: `(B${curR}/100)*${kwhCellRef}+(C${curR}/100)*365` };
  curRow.getCell(2).numFmt = rateFmt;
  curRow.getCell(3).numFmt = rateFmt;
  curRow.getCell(5).numFmt = moneyFmt;
  curRow.getCell(5).font = { bold: true };
  curRow.eachCell((c) => { c.border = border; });
  const currentCostRef = `E${curR}`;

  // ── Quotes ──
  ws.addRow([]);
  sectionHeader(ws, 'THE MARKET — QUOTES RETURNED');
  tableHeader(ws, ['Supplier', 'Term', 'Unit rate (p/kWh)', 'Standing (p/day)', 'Annual cost (£)', 'Saving vs current (£)']);

  const live = cost.quotes.filter((q) => q.supplier.trim() || q.unitRate.trim() || q.standing.trim());
  // recommended row id from the computed result (lowest cost / explicit flag)
  const recSupplier = computed.summary.facts.find((f) => f.label === 'Recommended')?.value ?? '';
  let recCostCell = '';
  live.forEach((q) => {
    const row = ws.addRow([q.supplier || '—', q.term || '', parseNum(q.unitRate) || null, parseNum(q.standing) || null, null, null]);
    const r = row.number;
    row.getCell(5).value = { formula: `(C${r}/100)*${kwhCellRef}+(D${r}/100)*365` };
    row.getCell(6).value = { formula: `${currentCostRef}-E${r}` };
    row.getCell(3).numFmt = rateFmt;
    row.getCell(4).numFmt = rateFmt;
    row.getCell(5).numFmt = moneyFmt;
    row.getCell(6).numFmt = moneyFmt;
    const isRec = q.recommended || (`${q.supplier} · ${q.term}` === recSupplier);
    if (isRec) {
      row.eachCell((c) => { c.fill = fill(TINT); c.font = { ...(c.font ?? {}), bold: true }; });
      row.getCell(1).value = `${q.supplier || '—'}  ★ Recommended`;
      recCostCell = `E${r}`;
    }
    row.eachCell((c) => { c.border = border; });
  });

  // ── Saving ──
  ws.addRow([]);
  const savingRow = ws.addRow(['Estimated annual saving (recommended vs current)', '', '', '', null, '']);
  ws.mergeCells(`A${savingRow.number}:D${savingRow.number}`);
  savingRow.getCell(1).font = { bold: true, color: { argb: GREEN_DARK } };
  if (recCostCell) savingRow.getCell(5).value = { formula: `${currentCostRef}-${recCostCell}` };
  savingRow.getCell(5).numFmt = moneyFmt;
  savingRow.getCell(5).font = { bold: true, color: { argb: GREEN_DARK } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  function sectionHeader(sheet: typeof ws, label: string) {
    const row = sheet.addRow([label]);
    sheet.mergeCells(`A${row.number}:F${row.number}`);
    row.getCell(1).font = { bold: true, size: 10, color: { argb: GREEN_DARK } };
    row.height = 18;
  }
  function tableHeader(sheet: typeof ws, labels: string[]) {
    const row = sheet.addRow(labels);
    row.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = fill(INK);
      c.alignment = { vertical: 'middle' };
      c.border = border;
    });
  }
}
