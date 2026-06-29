import type { ClientProfile, ClientMeter } from '../../lib/api';
import { getField, getMeters, meterSites } from '../../lib/clientProfile';
import {
  meterAnnualCost, money0, int, pct0, num, parseNum, termYears, dateLong, todayLong, addDaysLong, escapeHtml,
} from '../engine';
import type {
  ReportTemplate, ReportState, TemplateField, CostData, MeterLine, ProposedSupplier, SupplierLine, ComputeResult,
} from '../types';
import { COST_COMPARISON_HTML } from './costComparison.html';

const GROUPS = ['Report', 'Client', 'Recommendation', 'Footer'];

// The editable token fields. The meters + proposed-supplier tables are bespoke datasets
// (edited in the studio's Cost-comparison editor), so they aren't token fields.
const FIELDS: TemplateField[] = [
  { key: 'reportTitle', label: 'Report title', group: 'Report', type: 'text', placeholder: 'Electricity Supply Review' },
  { key: 'ledeNote', label: 'Subtitle note', group: 'Report', type: 'text', placeholder: '2 meters · 2 sites' },
  { key: 'consultantName', label: 'Consultant', group: 'Report', type: 'text', placeholder: 'Will Hartley' },
  { key: 'reportRef', label: 'Report ref', group: 'Report', type: 'text' },
  { key: 'issueDate', label: 'Issued', group: 'Report', type: 'text' },
  { key: 'validUntil', label: 'Valid until', group: 'Report', type: 'text' },
  { key: 'clientName', label: 'Client name', group: 'Client', type: 'text', bound: true },
  { key: 'contractEndDate', label: 'Current contract ends', group: 'Client', type: 'text', bound: true },
  { key: 'summaryCurrent', label: 'Summary — current position', group: 'Recommendation', type: 'multiline', ai: true, full: true },
  { key: 'summaryRecommended', label: 'Summary — what we found', group: 'Recommendation', type: 'multiline', ai: true, full: true },
  { key: 'recommendationTitle', label: 'Recommendation title', group: 'Recommendation', type: 'text', ai: true, full: true },
  { key: 'recommendationRationale', label: 'Recommendation rationale', group: 'Recommendation', type: 'multiline', ai: true, full: true },
  { key: 'step1', label: 'Step 1', group: 'Recommendation', type: 'text', full: true },
  { key: 'step2', label: 'Step 2', group: 'Recommendation', type: 'text', full: true },
  { key: 'step3', label: 'Step 3', group: 'Recommendation', type: 'text', full: true },
  { key: 'taxBasis', label: 'Tax basis', group: 'Footer', type: 'text', full: true },
  { key: 'complaintsEmail', label: 'Complaints email', group: 'Footer', type: 'email' },
];

const ref = (): string => `GS-CC-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 8999))}`;
export function rid(): string { return Math.random().toString(36).slice(2, 9); }

function asInputs(client: ClientProfile | null) {
  return (client?.inputs ?? {}) as ClientProfile['inputs'];
}
// Earliest contract end across the client's meters, else the headline contractEnd.
function clientContractEnd(inputs: ReturnType<typeof asInputs>): string {
  const meterEnds = getMeters(inputs).map((m) => (m.contractEnd ?? '').trim()).filter(Boolean);
  return meterEnds[0] || getField(inputs, 'contractEnd') || '';
}

export const emptySupplier = (): ProposedSupplier => ({ id: rid(), name: '', term: '', lines: {}, recommended: true });
export function blankMeter(fuel: 'electric' | 'gas' = 'electric'): MeterLine {
  return { id: rid(), meterNumber: '', fuel, site: '', currentSupplier: '', dayConsumption: '', dayRate: '', nightConsumption: '', nightRate: '', standing: '' };
}

// Build the meter rows from the client's stored meters (dynamically tailored to what we
// hold about them). Single-meter clients also pull the headline current rates so the row
// is pre-populated; multi-meter clients seed identity + consumption and leave rates blank.
function metersFromClient(inputs: ReturnType<typeof asInputs>): MeterLine[] {
  const meters = getMeters(inputs);
  const single = meters.length === 1;
  const headlineRate = getField(inputs, 'currentUnitRate');
  const headlineStanding = getField(inputs, 'currentStanding');
  if (meters.length) {
    return meters.map((m: ClientMeter) => ({
      id: rid(),
      meterNumber: (m.type === 'gas' ? m.mprn : m.mpan) || '',
      fuel: m.type,
      site: (m.siteAddress ?? '').trim(),
      currentSupplier: (m.supplier ?? '').trim() || getField(inputs, 'currentSupplier'),
      dayConsumption: fmtConsumption(m.consumption),
      dayRate: single ? headlineRate : '',
      nightConsumption: '',
      nightRate: '',
      standing: single ? headlineStanding : '',
    }));
  }
  // No meters on file → one row seeded from the headline record.
  return [{
    id: rid(),
    meterNumber: '',
    fuel: 'electric',
    site: getField(inputs, 'businessAddress'),
    currentSupplier: getField(inputs, 'currentSupplier'),
    dayConsumption: fmtConsumption(getField(inputs, 'consumption')),
    dayRate: headlineRate,
    nightConsumption: '',
    nightRate: '',
    standing: headlineStanding,
  }];
}
function fmtConsumption(c: string | undefined): string {
  const n = parseNum(c ?? '');
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

function seed(client: ClientProfile | null): ReportState {
  const inputs = asInputs(client);
  const company = getField(inputs, 'companyName') || client?.name || '';
  const end = clientContractEnd(inputs);
  const meters = metersFromClient(inputs);
  const siteCount = new Set(meters.map((m) => m.site.trim().toLowerCase()).filter(Boolean)).size || 1;
  const cost: CostData = { meters, proposed: [emptySupplier()] };
  const values: Record<string, string> = {
    reportRef: ref(),
    issueDate: todayLong(),
    validUntil: addDaysLong(7),
    reportTitle: 'Electricity Supply Review',
    ledeNote: `${meters.length} meter${meters.length === 1 ? '' : 's'} · ${siteCount} site${siteCount === 1 ? '' : 's'}`,
    clientName: company,
    contractEndDate: end ? dateLong(end) : '',
    consultantName: '',
    savingBasis: 'current rates',
    summaryCurrent:
      'Your current supply is due to roll onto out-of-contract deemed rates when the fixed term ends. Deemed rates are typically the highest tariff a supplier charges and carry no price protection.',
    summaryRecommended:
      'We took your meter-by-meter usage to market across our panel of business suppliers. The strongest option, highlighted below, secures budget certainty at the lowest all-in cost across your portfolio.',
    recommendationTitle: '',
    recommendationRationale:
      'A longer fixed term locks in today’s rates and removes price risk across multiple budget cycles. The all-in cost across every meter is the lowest of the panel, giving a single, predictable line on every bill — no exposure to deemed rates or mid-term price moves.',
    step1: 'Confirm you’re happy with the recommended option and term length.',
    step2: 'We prepare the contract for e-signature and handle the switch end-to-end.',
    step3: 'Your account manager sets up renewal monitoring so we’re back in the market in good time before this contract ends.',
    taxBasis: 'exclude VAT, CCL and third-party (DUoS/TNUoS) pass-through charges where applicable.',
    complianceRegistration:
      'We adhere to a recognised industry code of practice and are a member of an approved redress scheme.',
    complaintsEmail: 'hello@greenshiftenergy.co.uk',
  };
  return { templateId: 'cost-comparison', clientProfileId: client?.id, title: company ? `Cost comparison — ${company}` : 'Cost comparison', values, data: { cost } };
}

// ── pricing ──
const z = (s: string) => { const n = parseNum(s); return Number.isFinite(n) ? n : 0; };
export function meterCost(m: MeterLine): number {
  return meterAnnualCost(parseNum(m.dayConsumption), parseNum(m.dayRate), parseNum(m.nightConsumption), parseNum(m.nightRate), parseNum(m.standing));
}
export function supplierMeterCost(line: SupplierLine | undefined, m: MeterLine): number {
  return meterAnnualCost(parseNum(m.dayConsumption), parseNum(line?.dayRate ?? ''), parseNum(m.nightConsumption), parseNum(line?.nightRate ?? ''), parseNum(line?.standing ?? ''));
}
export function currentTotal(meters: MeterLine[]): number { return meters.reduce((s, m) => s + meterCost(m), 0); }
export function supplierLive(s: ProposedSupplier): boolean {
  return !!s.name.trim() || Object.values(s.lines).some((l) => (l.dayRate + l.nightRate + l.standing).trim() !== '');
}
export function supplierTotal(s: ProposedSupplier, meters: MeterLine[]): number {
  return meters.reduce((sum, m) => sum + supplierMeterCost(s.lines[m.id], m), 0);
}
// The recommended proposed supplier: an explicit ★, else the cheapest live one.
export function recommendedSupplierIndex(proposed: ProposedSupplier[], meters: MeterLine[]): number {
  const explicit = proposed.findIndex((s) => s.recommended && supplierLive(s));
  if (explicit >= 0) return explicit;
  let best = -1, bestCost = Infinity;
  proposed.forEach((s, i) => { if (supplierLive(s)) { const c = supplierTotal(s, meters); if (c < bestCost) { bestCost = c; best = i; } } });
  return best;
}

// Migrate an older saved cost report ({ current, quotes }) into the meter/proposed shape.
// `legacyKwh` recovers the old single annual-consumption figure (it lived on
// state.values.annualKwh, not in the cost dataset) so migrated annual costs stay real.
export function normalizeCost(cost: CostData | undefined, legacyKwh?: string): CostData {
  if (cost && Array.isArray(cost.meters)) return { meters: cost.meters, proposed: Array.isArray(cost.proposed) ? cost.proposed : [emptySupplier()] };
  const legacy = cost as unknown as { current?: { supplier?: string; unitRate?: string; standing?: string }; quotes?: Array<{ id?: string; supplier?: string; term?: string; unitRate?: string; standing?: string; recommended?: boolean }> } | undefined;
  const meter: MeterLine = {
    id: rid(), meterNumber: '', fuel: 'electric', site: '',
    currentSupplier: legacy?.current?.supplier ?? '',
    dayConsumption: fmtConsumption(legacyKwh), dayRate: legacy?.current?.unitRate ?? '', nightConsumption: '', nightRate: '',
    standing: legacy?.current?.standing ?? '',
  };
  const proposed: ProposedSupplier[] = (legacy?.quotes ?? [])
    .filter((q) => (q.supplier ?? '').trim() || (q.unitRate ?? '').trim())
    .map((q) => ({ id: q.id || rid(), name: q.supplier ?? '', term: q.term ?? '', recommended: q.recommended, lines: { [meter.id]: { dayRate: q.unitRate ?? '', nightRate: '', standing: q.standing ?? '' } } }));
  return { meters: [meter], proposed: proposed.length ? proposed : [emptySupplier()] };
}

// ── the branded comparison tables (one current block + a proposed block per supplier) ──
const COLS = ['Meter number', 'Supplier', 'Day kWh', 'Day p/kWh', 'Night kWh', 'Night p/kWh', 'Standing p/day', 'Annual cost'];
function cellNum(v: string): string { return v.trim() ? escapeHtml(v.trim()) : '<span style="color:var(--ink-40)">—</span>'; }
function kwhCell(v: string): string { const n = parseNum(v); return Number.isFinite(n) && n > 0 ? int(n) : '<span style="color:var(--ink-40)">—</span>'; }
function meterRow(meterNumber: string, fuel: string, site: string, supplier: string, dayK: string, dayR: string, nightK: string, nightR: string, standing: string, cost: number): string {
  const ident = `${escapeHtml(meterNumber || '—')}${site ? `<br><span class="product">${escapeHtml(site)}</span>` : `<br><span class="product">${fuel === 'gas' ? 'Gas' : 'Electricity'}</span>`}`;
  return `<tr>
    <td class="l num">${ident}</td>
    <td class="l"><span class="supplier" style="font-size:12px">${escapeHtml(supplier || '—')}</span></td>
    <td class="num">${kwhCell(dayK)}</td>
    <td class="num">${cellNum(dayR)}</td>
    <td class="num">${kwhCell(nightK)}</td>
    <td class="num">${cellNum(nightR)}</td>
    <td class="num">${cellNum(standing)}</td>
    <td class="num" style="font-weight:600">&pound;${money0(cost)}</td>
  </tr>`;
}
function block(title: string, pill: string, rows: string, total: number, klass: string): string {
  const head = COLS.map((c, i) => `<th class="${i < 2 ? 'l' : ''}">${escapeHtml(c)}</th>`).join('');
  return `<section>
    <div class="sec-head"><span class="eyebrow">${escapeHtml(title)}</span>${pill}<span class="hr"></span></div>
    <table class="cc-table ${klass}">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}
        <tr class="cc-total"><td class="l" colspan="7">Total annual cost</td><td class="num">&pound;${money0(total)}</td></tr>
      </tbody>
    </table>
  </section>`;
}
function buildTables(cost: CostData): string {
  const meters = cost.meters.length ? cost.meters : [blankMeter()];
  const curRows = meters.map((m) => meterRow(m.meterNumber, m.fuel, m.site, m.currentSupplier, m.dayConsumption, m.dayRate, m.nightConsumption, m.nightRate, m.standing, meterCost(m))).join('');
  const recIdx = recommendedSupplierIndex(cost.proposed, meters);
  const blocks = [block('Your current annual cost', '', curRows, currentTotal(meters), 'current-table')];
  cost.proposed.forEach((s, i) => {
    if (!supplierLive(s)) return;
    const rows = meters.map((m) => meterRow(m.meterNumber, m.fuel, m.site, s.name || `Supplier ${i + 1}`, m.dayConsumption, s.lines[m.id]?.dayRate ?? '', m.nightConsumption, s.lines[m.id]?.nightRate ?? '', s.lines[m.id]?.standing ?? '', supplierMeterCost(s.lines[m.id], m))).join('');
    const isRec = i === recIdx;
    const title = `${s.name || `Supplier ${i + 1}`} — annual cost of energy${s.term.trim() ? ` · ${s.term.trim()}` : ''}`;
    blocks.push(block(title, isRec ? '<span class="pill">Recommended</span>' : '', rows, supplierTotal(s, meters), isRec ? 'rec-table' : ''));
  });
  return blocks.join('\n');
}

function compute(state: ReportState): ComputeResult {
  const v = state.values;
  const cost = normalizeCost(state.data.cost, v.annualKwh);
  const meters = cost.meters.length ? cost.meters : [blankMeter()];
  const curTotal = currentTotal(meters);
  const recIdx = recommendedSupplierIndex(cost.proposed, meters);
  const rec = recIdx >= 0 ? cost.proposed[recIdx] : null;
  const recTotal = rec ? supplierTotal(rec, meters) : NaN;
  const saving = Number.isFinite(curTotal) && Number.isFinite(recTotal) ? curTotal - recTotal : NaN;
  const savingPct = Number.isFinite(saving) && curTotal > 0 ? (saving / curTotal) * 100 : NaN;
  const years = rec ? termYears(rec.term) : 1;
  const termSaving = Number.isFinite(saving) ? saving * years : NaN;

  const totalDay = meters.reduce((s, m) => s + z(m.dayConsumption), 0);
  const totalNight = meters.reduce((s, m) => s + z(m.nightConsumption), 0);
  const totalKwh = totalDay + totalNight;
  const siteCount = new Set(meters.map((m) => m.site.trim().toLowerCase()).filter(Boolean)).size || 1;

  const recTitle = v.recommendationTitle?.trim()
    || (rec ? `Secure the ${rec.term || 'recommended option'} with ${rec.name || 'the recommended supplier'}` : 'Our recommendation');

  const tokens: Record<string, string> = {
    ...v,
    comparisonTables: buildTables(cost),
    meterCount: String(meters.length),
    siteCount: String(siteCount),
    totalConsumptionLabel: totalKwh > 0 ? `${int(totalKwh)} kWh` : '—',
    currentAnnualCost: money0(curTotal),
    recommendedSupplier: rec ? (rec.name || 'recommended supplier') : '—',
    recommendedCost: money0(recTotal),
    annualSaving: money0(saving),
    savingPct: Number.isFinite(savingPct) ? pct0(savingPct) : '—',
    savingBasis: v.savingBasis || 'current rates',
    termYears: String(years),
    termSaving: money0(termSaving),
    recommendationTitle: recTitle,
  };

  const summary = {
    headline: rec && Number.isFinite(saving)
      ? `Recommend ${rec.name || 'top quote'} — saves £${money0(saving)}/yr (${pct0(savingPct)}) across ${meters.length} meter${meters.length === 1 ? '' : 's'}`
      : 'Cost comparison',
    facts: [
      { label: 'Meters', value: `${meters.length} · ${siteCount} site${siteCount === 1 ? '' : 's'}` },
      { label: 'Total consumption', value: totalKwh > 0 ? `${int(totalKwh)} kWh` : '—' },
      { label: 'Recommended', value: rec ? `${rec.name || 'top quote'}${rec.term ? ` · ${rec.term}` : ''}` : '—' },
      { label: 'Annual saving', value: Number.isFinite(saving) ? `£${money0(saving)} (${pct0(savingPct)})` : '—' },
      { label: `${years}-year value`, value: Number.isFinite(termSaving) ? `£${money0(termSaving)}` : '—' },
    ],
  };

  void num;
  return { tokens, lists: {}, summary };
}

async function excel(state: ReportState): Promise<Blob> {
  const { buildCostComparisonWorkbook } = await import('../excel');
  return buildCostComparisonWorkbook(state, compute(state));
}

// Two-way binding kept light: only the client name round-trips. Meter rows are seeded FROM
// the client on creation and edited in the report (a structured per-meter write-back would
// be ambiguous), so they don't sync back automatically.
const ci = (i: Record<string, unknown>) => i as ReturnType<typeof asInputs>;
const boundFields = [
  { key: 'clientName', read: (i: Record<string, unknown>) => getField(ci(i), 'companyName'), write: (v: string) => ({ companyName: v }) },
  { key: 'contractEndDate', read: (i: Record<string, unknown>) => { const e = clientContractEnd(ci(i)); return e ? dateLong(e) : ''; }, write: (v: string) => ({ contractEnd: v }), readOnly: true },
];

export const costComparisonTemplate: ReportTemplate = {
  id: 'cost-comparison',
  kind: 'cost-comparison',
  name: 'Cost Comparison Report',
  description: 'Multi-meter, day/night tender comparison → a branded report + matching Excel, built from the client’s meters with the saving and recommendation worked out for you.',
  accent: 'text-brand-greenDark',
  html: COST_COMPARISON_HTML,
  fields: FIELDS,
  groups: GROUPS,
  boundFields,
  seed,
  compute,
  excel,
};
