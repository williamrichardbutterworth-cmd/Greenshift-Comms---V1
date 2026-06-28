import type { ClientProfile } from '../../lib/api';
import { getField, getMeters, meterSites } from '../../lib/clientProfile';
import {
  annualCost, money0, int, pct0, parseNum, termYears, dateLong, todayLong, addDaysLong,
} from '../engine';
import type {
  ReportTemplate, ReportState, TemplateField, CostData, QuoteRow, ComputeResult,
} from '../types';
import { COST_COMPARISON_HTML } from './costComparison.html';

const GROUPS = ['Report', 'Client', 'Current position', 'Recommendation', 'Footer'];

// The editable token fields (the quotes grid + current position are bespoke datasets).
const FIELDS: TemplateField[] = [
  { key: 'reportTitle', label: 'Report title', group: 'Report', type: 'text', placeholder: 'Electricity Supply Review' },
  { key: 'ledeNote', label: 'Subtitle note', group: 'Report', type: 'text', placeholder: 'Single site, half-hourly' },
  { key: 'consultantName', label: 'Consultant', group: 'Report', type: 'text', placeholder: 'Will Hartley' },
  { key: 'reportRef', label: 'Report ref', group: 'Report', type: 'text' },
  { key: 'issueDate', label: 'Issued', group: 'Report', type: 'text' },
  { key: 'validUntil', label: 'Valid until', group: 'Report', type: 'text' },
  { key: 'clientName', label: 'Client name', group: 'Client', type: 'text', bound: true },
  { key: 'annualKwh', label: 'Annual consumption (kWh)', group: 'Client', type: 'number', bound: true, help: 'Drives every annual-cost figure.' },
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

const emptyQuote = (): QuoteRow => ({ id: rid(), supplier: '', term: '', unitRate: '', standing: '' });
function rid(): string { return Math.random().toString(36).slice(2, 9); }

// Earliest contract end across the client's meters, else the headline contractEnd.
function clientContractEnd(inputs: ReturnType<typeof asInputs>): string {
  const meterEnds = getMeters(inputs).map((m) => (m.contractEnd ?? '').trim()).filter(Boolean);
  return meterEnds[0] || getField(inputs, 'contractEnd') || '';
}
function asInputs(client: ClientProfile | null) {
  return (client?.inputs ?? {}) as ClientProfile['inputs'];
}

function seed(client: ClientProfile | null): ReportState {
  const inputs = asInputs(client);
  const company = getField(inputs, 'companyName') || client?.name || '';
  const kwh = parseNum(getField(inputs, 'consumption'));
  const end = clientContractEnd(inputs);
  const cost: CostData = {
    current: {
      supplier: getField(inputs, 'currentSupplier'),
      product: getField(inputs, 'currentProduct') || 'Out-of-contract / deemed',
      unitRate: getField(inputs, 'currentUnitRate'),
      standing: getField(inputs, 'currentStanding'),
      termStatus: end ? `Expires ${dateLong(end)}` : '',
    },
    quotes: [emptyQuote(), emptyQuote(), emptyQuote()],
  };
  const values: Record<string, string> = {
    reportRef: ref(),
    issueDate: todayLong(),
    validUntil: addDaysLong(7),
    reportTitle: 'Electricity Supply Review',
    ledeNote: meterSites(getMeters(inputs)) ? 'Single site' : 'Single site',
    clientName: company,
    annualKwh: Number.isFinite(kwh) ? String(kwh) : '',
    contractEndDate: end ? dateLong(end) : '',
    consultantName: '',
    savingBasis: 'out-of-contract rates',
    summaryCurrent:
      'Your current supply is due to roll onto out-of-contract deemed rates when the fixed term ends. Deemed rates are typically the highest tariff a supplier charges and carry no price protection.',
    summaryRecommended:
      'We took your usage to market across our panel of business suppliers. The strongest option, highlighted below, secures budget certainty at the lowest all-in cost of the quotes returned.',
    recommendationTitle: '',
    recommendationRationale:
      'A longer fixed term locks in today’s rates and removes price risk across multiple budget cycles. The all-in cost is the lowest of the panel, giving a single, predictable line on every monthly bill — no exposure to deemed rates or mid-term price moves.',
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

// A quote with its computed annual cost; only "live" rows (a supplier or any rate).
interface PricedQuote extends QuoteRow { cost: number; live: boolean; }
function priceQuotes(quotes: QuoteRow[], kwh: number): PricedQuote[] {
  return quotes.map((q) => {
    const live = !!(q.supplier.trim() || q.unitRate.trim() || q.standing.trim());
    const cost = annualCost(parseNum(q.unitRate), parseNum(q.standing), kwh);
    return { ...q, cost, live };
  });
}

function recommendedIndex(priced: PricedQuote[]): number {
  const explicit = priced.findIndex((q) => q.recommended && q.live);
  if (explicit >= 0) return explicit;
  let best = -1, bestCost = Infinity;
  priced.forEach((q, i) => { if (q.live && Number.isFinite(q.cost) && q.cost < bestCost) { bestCost = q.cost; best = i; } });
  return best;
}

function compute(state: ReportState): ComputeResult {
  const v = state.values;
  const cost = state.data.cost ?? { current: { supplier: '', product: '', unitRate: '', standing: '', termStatus: '' }, quotes: [] };
  const kwh = parseNum(v.annualKwh);
  const currentCost = annualCost(parseNum(cost.current.unitRate), parseNum(cost.current.standing), kwh);

  const priced = priceQuotes(cost.quotes, kwh);
  const recIdx = recommendedIndex(priced);
  const rec = recIdx >= 0 ? priced[recIdx] : null;
  const recCost = rec ? rec.cost : NaN;
  const saving = Number.isFinite(currentCost) && Number.isFinite(recCost) ? currentCost - recCost : NaN;
  const savingPct = Number.isFinite(saving) && currentCost > 0 ? (saving / currentCost) * 100 : NaN;
  const years = rec ? termYears(rec.term) : 1;
  const termSaving = Number.isFinite(saving) ? saving * years : NaN;

  const recTitle = v.recommendationTitle?.trim()
    || (rec ? `Secure the ${rec.term || 'recommended option'} with ${rec.supplier || 'the recommended supplier'}` : 'Our recommendation');

  const lists = {
    quotes: priced.filter((q) => q.live).map((q, i) => {
      const isRec = recIdx >= 0 && priced[recIdx].id === q.id;
      const delta = Number.isFinite(currentCost) && Number.isFinite(q.cost) ? currentCost - q.cost : NaN;
      const deltaText = !Number.isFinite(delta) ? '—'
        : delta > 0 ? `&minus;&pound;${money0(delta)}`
        : delta < 0 ? `+&pound;${money0(-delta)}`
        : '&pound;0';
      return {
        supplier: q.supplier || `Supplier ${i + 1}`,
        term: q.term,
        unitRate: q.unitRate,
        standing: q.standing,
        annualCost: money0(q.cost),
        rowClass: isRec ? 'rec' : '',
        recPill: isRec ? '<span class="pill">Recommended</span>' : '',
        deltaClass: !Number.isFinite(delta) ? '' : delta >= 0 ? 'delta-pos' : 'delta-neg',
        deltaText,
      };
    }),
  };

  const tokens: Record<string, string> = {
    ...v,
    annualKwhLabel: Number.isFinite(kwh) ? `${int(kwh)} kWh` : '—',
    annualSaving: money0(saving),
    savingPct: Number.isFinite(savingPct) ? pct0(savingPct) : '—',
    savingBasis: v.savingBasis || 'out-of-contract rates',
    termYears: String(years),
    termSaving: money0(termSaving),
    currentSupplier: cost.current.supplier || '—',
    currentProduct: cost.current.product || '—',
    currentUnitRate: cost.current.unitRate || '—',
    currentStanding: cost.current.standing || '—',
    currentTermStatus: cost.current.termStatus || '—',
    currentAnnualCost: money0(currentCost),
    recommendationTitle: recTitle,
  };

  const summary = {
    headline: rec && Number.isFinite(saving)
      ? `Recommend ${rec.supplier || 'top quote'} — saves £${money0(saving)}/yr (${pct0(savingPct)})`
      : 'Cost comparison',
    facts: [
      { label: 'Recommended', value: rec ? `${rec.supplier} · ${rec.term}` : '—' },
      { label: 'Annual saving', value: Number.isFinite(saving) ? `£${money0(saving)} (${pct0(savingPct)})` : '—' },
      { label: `${years}-year value`, value: Number.isFinite(termSaving) ? `£${money0(termSaving)}` : '—' },
      { label: 'Quotes', value: String(lists.quotes.length) },
    ],
  };

  return { tokens, lists, summary };
}

async function excel(state: ReportState): Promise<Blob> {
  const { buildCostComparisonWorkbook } = await import('../excel');
  return buildCostComparisonWorkbook(state, compute(state));
}

// Two-way bindings to the client record (the single source of truth). The 'current.*'
// keys target the cost current-position editor; the rest are token values.
const ci = (i: Record<string, unknown>) => i as ReturnType<typeof asInputs>;
const boundFields = [
  { key: 'clientName', read: (i: Record<string, unknown>) => getField(ci(i), 'companyName'), write: (v: string) => ({ companyName: v }) },
  { key: 'annualKwh', read: (i: Record<string, unknown>) => { const n = parseNum(getField(ci(i), 'consumption')); return Number.isFinite(n) ? String(n) : ''; }, write: (v: string) => ({ consumption: v }) },
  { key: 'contractEndDate', read: (i: Record<string, unknown>) => { const e = clientContractEnd(ci(i)); return e ? dateLong(e) : ''; }, write: (v: string) => ({ contractEnd: v }), readOnly: true },
  { key: 'current.supplier', read: (i: Record<string, unknown>) => getField(ci(i), 'currentSupplier'), write: (v: string) => ({ currentSupplier: v }) },
  { key: 'current.product', read: (i: Record<string, unknown>) => getField(ci(i), 'currentProduct'), write: (v: string) => ({ currentProduct: v }) },
  { key: 'current.unitRate', read: (i: Record<string, unknown>) => getField(ci(i), 'currentUnitRate'), write: (v: string) => ({ currentUnitRate: v }) },
  { key: 'current.standing', read: (i: Record<string, unknown>) => getField(ci(i), 'currentStanding'), write: (v: string) => ({ currentStanding: v }) },
];

export const costComparisonTemplate: ReportTemplate = {
  id: 'cost-comparison',
  kind: 'cost-comparison',
  name: 'Cost Comparison Report',
  description: 'Tender quotes → a branded comparison report + matching Excel, with the saving and recommendation worked out for you.',
  accent: 'text-brand-greenDark',
  html: COST_COMPARISON_HTML,
  fields: FIELDS,
  groups: GROUPS,
  boundFields,
  seed,
  compute,
  excel,
};
