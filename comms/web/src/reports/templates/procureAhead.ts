import { api, type ClientProfile, type Metric } from '../../lib/api';
import { getField, getMeters } from '../../lib/clientProfile';
import { analyzeCurve, curveSignal, chartLegs, legValue } from '../../lib/forwardCurve';
import { dateLong, todayLong } from '../engine';
import { buildForwardCurveSvg } from '../trendSvg';
import type { ReportTemplate, ReportState, TemplateField, ProcureCard, ProcureData, ComputeResult } from '../types';
import { PROCURE_AHEAD_HTML } from './procureAhead.html';

const GROUPS = ['Report', 'Client', 'Outlook', 'Footer'];

const FIELDS: TemplateField[] = [
  { key: 'reportRef', label: 'Brief ref', group: 'Report', type: 'text' },
  { key: 'weekOf', label: 'Week of', group: 'Report', type: 'text' },
  { key: 'briefSubtitle', label: 'Subtitle', group: 'Report', type: 'text', full: true },
  { key: 'chartCaption', label: 'Chart caption', group: 'Report', type: 'multiline', ai: true, full: true },
  { key: 'clientName', label: 'Client name', group: 'Client', type: 'text', bound: true },
  { key: 'contractEndDate', label: 'Contract ends', group: 'Client', type: 'text', bound: true, help: 'Tailors the “what this means for you” read.' },
  { key: 'commentaryDrivers', label: 'What’s moving the market', group: 'Outlook', type: 'multiline', ai: true, full: true },
  { key: 'commentaryOutlook', label: 'Outlook', group: 'Outlook', type: 'multiline', ai: true, full: true },
  { key: 'implication', label: 'What this means for you', group: 'Outlook', type: 'multiline', ai: true, full: true },
  { key: 'stanceTag', label: 'Stance tag', group: 'Outlook', type: 'text', ai: true },
  { key: 'stanceHeadline', label: 'Stance headline', group: 'Outlook', type: 'text', ai: true, full: true },
  { key: 'stanceRationale', label: 'Stance rationale', group: 'Outlook', type: 'multiline', ai: true, full: true },
  { key: 'talkingPoint1', label: 'Talking point 1', group: 'Outlook', type: 'text', ai: true, full: true },
  { key: 'talkingPoint2', label: 'Talking point 2', group: 'Outlook', type: 'text', ai: true, full: true },
  { key: 'talkingPoint3', label: 'Talking point 3', group: 'Outlook', type: 'text', ai: true, full: true },
  { key: 'talkingPoint4', label: 'Talking point 4', group: 'Outlook', type: 'text', ai: true, full: true },
  { key: 'complianceRegistration', label: 'Compliance note', group: 'Footer', type: 'multiline', full: true },
];

function isoWeek(d = new Date()): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date.getTime() - firstThu.getTime()) / 86400000 / 7);
}

function clientContractEnd(inputs: ClientProfile['inputs']): string {
  const meterEnds = getMeters(inputs).map((m) => (m.contractEnd ?? '').trim()).filter(Boolean);
  return meterEnds[0] || getField(inputs, 'contractEnd') || '';
}

function seed(client: ClientProfile | null): ReportState {
  const inputs = (client?.inputs ?? {}) as ClientProfile['inputs'];
  const company = getField(inputs, 'companyName') || client?.name || '';
  const end = clientContractEnd(inputs);
  const endLabel = end ? dateLong(end) : '';
  const values: Record<string, string> = {
    reportRef: `GS-MB-${new Date().getFullYear()}-W${isoWeek()}`,
    weekOf: todayLong(),
    clientName: company,
    contractEndDate: endLabel,
    briefSubtitle: 'Where the UK power forward curve sits — and what it means for your renewal',
    chartCaption: 'The forward curve shows each delivery period’s price; your renewal window is marked. A curve that slopes down (backwardation) means securing ahead beats waiting and re-buying near-term.',
    commentaryDrivers:
      'Prices have softened on milder weather, comfortable gas storage across North-West Europe and subdued industrial demand. The winter risk premium that pushed the curve up late last year has largely unwound, leaving the front of the curve in a tighter, lower range.',
    commentaryOutlook:
      'The outlook is balanced rather than bullish: summer storage refill is on track, but the market stays sensitive to supply news and the first cold snap of the next heating season. Today’s levels reflect a relatively benign moment that may not hold once winter hedging resumes.',
    implication: endLabel
      ? `With your current contract ending ${endLabel}, you’re renewing into one of the calmer windows of the past 18 months. Fixing now captures these lower forward rates and shelters your budget from the price risk that typically builds as the market moves into autumn.`
      : 'You’re renewing into one of the calmer windows of the past 18 months. Fixing now captures these lower forward rates and shelters your budget from the price risk that typically builds as the market moves into autumn.',
    stanceTag: 'Act — window open',
    stanceHeadline: 'Fix a longer term now to lock in today’s lower rates',
    stanceRationale:
      'Rather than ride out-of-contract rates or take a short fix and re-buy into uncertainty, securing a 24–36 month fixed contract converts this softer market into budget certainty. Talking points for the conversation:',
    talkingPoint1: 'Power is below its winter peak — a materially better entry point than last year.',
    talkingPoint2: 'A longer fixed term removes exposure to the risk premium that tends to return with the heating season.',
    talkingPoint3: 'Locking in now means budget certainty across multiple financial years, not just the next one.',
    talkingPoint4: 'As your full-service consultancy, we monitor the market on your behalf and re-tender ahead of expiry — you never roll onto deemed rates.',
    complianceRegistration: 'Green Shift Energy Consulting is a third-party intermediary; commission arrangements are disclosed on request.',
  };
  return { templateId: 'procure-ahead', clientProfileId: client?.id, title: company ? `Procure-ahead brief — ${company}` : 'Procure-ahead brief', values, data: {} };
}

// ── live market data → the procure datasets (called by the studio) ──
const fmtN = (n: number, dp: number) => (dp ? n.toFixed(dp) : String(Math.round(n)));
function card(value: number | null, prev: number | null, sym: string, dp: number): ProcureCard {
  if (value == null || !Number.isFinite(value)) return { value: '—', deltaText: '', dir: 'flat' };
  const v = fmtN(value, dp);
  if (prev == null || !Number.isFinite(prev) || prev === 0) return { value: v, deltaText: '', dir: 'flat' };
  const abs = value - prev;
  const pct = (abs / prev) * 100;
  const dir = abs < -0.0001 ? 'down' : abs > 0.0001 ? 'up' : 'flat';
  return { value: v, deltaText: `${sym}${fmtN(Math.abs(abs), dp)} (${Math.abs(Math.round(pct))}%)`, dir };
}
function cardFromMetric(m: Metric | null, sym: string, dp: number): ProcureCard {
  if (!m || m.value == null) return { value: '—', deltaText: '', dir: 'flat' };
  const prev = m.changePct != null ? Number(m.value) / (1 + m.changePct / 100) : null;
  return card(Number(m.value), prev, sym, dp);
}

export async function loadProcureData(): Promise<ProcureData> {
  const [market, curve] = await Promise.all([
    api.market().catch(() => null),
    api.forwardCurve.latest().catch(() => null),
  ]);
  const metric = (id: string) => market?.metrics.find((m) => m.id === id) ?? null;
  const powerDa = metric('power_da');
  const gas = metric('nbp_gas') ?? metric('gas_sap');
  const brent = metric('brent');

  const powerCurve = curve?.curves.find((c) => c.commodity === 'power') ?? null;
  const analysis = powerCurve ? analyzeCurve(powerCurve) : null;
  const frontVal = analysis ? analysis.frontValue : null;
  const frontPrev = analysis?.front?.prev ?? null;
  const signal = analysis ? curveSignal(analysis) : '';

  // The forward curve to plot (the dashboard's curve): every priced FORWARD contract
  // (drop day-ahead spot so the curve reads cleanly), near → far.
  const curveLegs = powerCurve
    ? chartLegs(powerCurve)
        .filter((l) => !/^da$/i.test(l.label))
        .map((l) => ({ label: l.label, value: legValue(l) as number }))
        .filter((l) => Number.isFinite(l.value))
    : [];
  const asOfRaw = market?.asOf || curve?.asOfDate || '';

  return {
    asOf: asOfRaw ? `as of ${dateLong(asOfRaw)}` : '',
    frontYearPower: card(frontVal, frontPrev, '£', 0),
    dayAheadPower: cardFromMetric(powerDa, '£', 0),
    gas: cardFromMetric(gas, '', 1),
    brent: cardFromMetric(brent, '$', 0),
    curveLegs,
    curveUnit: powerCurve?.unit || '£/MWh',
    signal,
    curveAsOf: curve?.asOfDate,
  };
}

// ── map the client's contract end → the forward delivery period they'd buy ──
const MONTHS3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const yr4 = (y: string) => { const n = parseInt(y, 10); return n < 100 ? n + 2000 : n; };
function legStartDate(label: string): Date | null {
  const l = label.trim();
  const s = l.match(/^(sum|summer|win|winter)\s*'?\s*(\d{2,4})$/i);
  if (s) { const yr = yr4(s[2]); return /^w/i.test(s[1]) ? new Date(yr, 9, 1) : new Date(yr, 3, 1); } // Win→Oct, Sum→Apr
  const m = l.match(/^([a-z]{3})[\s-]?'?\s*(\d{2,4})$/i);
  if (m && MONTHS3.includes(m[1].toLowerCase())) return new Date(yr4(m[2]), MONTHS3.indexOf(m[1].toLowerCase()), 1);
  const q = l.match(/^q([1-4])[\s-]?'?\s*(\d{2,4})$/i);
  if (q) return new Date(yr4(q[2]), (parseInt(q[1], 10) - 1) * 3, 1);
  return null;
}
// The first forward period starting on/after the contract end (the period they procure
// into); failing that, the furthest leg shown (= the last leg on the chart's near→far
// ladder, so the highlight always agrees with compute's "furthest"). -1 if unparseable.
function procurementTargetIndex(legs: { label: string; value: number }[], contractEnd: string): number {
  const ce = contractEnd ? new Date(contractEnd) : null;
  if (!ce || Number.isNaN(ce.getTime())) return -1;
  let after = -1, afterT = Infinity;
  legs.forEach((leg, i) => {
    const d = legStartDate(leg.label); if (!d) return;
    const t = d.getTime();
    if (t >= ce.getTime() && t < afterT) { afterT = t; after = i; }
  });
  return after >= 0 ? after : (legs.length ? legs.length - 1 : -1);
}

const arrow = (dir: ProcureCard['dir']) => (dir === 'down' ? '&#9660;' : dir === 'up' ? '&#9650;' : '');

function compute(state: ReportState): ComputeResult {
  const v = state.values;
  const p = state.data.procure;
  const blank: ProcureCard = { value: '—', deltaText: '', dir: 'flat' };
  const fy = p?.frontYearPower ?? blank, da = p?.dayAheadPower ?? blank, gas = p?.gas ?? blank, br = p?.brent ?? blank;

  // Forward curve + the client's renewal leg, mapped from their contract end date.
  const legs = p?.curveLegs ?? [];
  const unit = p?.curveUnit || '£/MWh';
  const targetIdx = procurementTargetIndex(legs, v.contractEndDate ?? '');
  const target = targetIdx >= 0 ? legs[targetIdx] : null;
  const front = legs[0] ?? null;
  const furthest = legs.length ? legs[legs.length - 1] : null;
  const gbp = (n: number) => `£${Math.round(n)}`;

  const tokens: Record<string, string> = {
    ...v,
    frontYearPower: fy.value, frontYearDelta: fy.deltaText, frontYearDir: fy.dir, frontYearArrow: arrow(fy.dir),
    dayAheadPower: da.value, dayAheadDelta: da.deltaText, dayAheadDir: da.dir, dayAheadArrow: arrow(da.dir),
    gasPrice: gas.value, gasDelta: gas.deltaText, gasDir: gas.dir, gasArrow: arrow(gas.dir),
    brent: br.value, brentDelta: br.deltaText, brentDir: br.dir, brentArrow: arrow(br.dir),
    asOf: p?.asOf ?? '',
    forwardCurveSvg: buildForwardCurveSvg(legs, { unit, highlightIdx: targetIdx, highlightLabel: 'your renewal' }),
  };

  const sig = p?.signal || '';
  const summary = {
    headline: sig ? `Forward curve: ${sig} — ${v.stanceHeadline ?? ''}`.trim() : (v.stanceHeadline ?? 'Procure-ahead brief'),
    facts: [
      { label: 'Curve signal', value: sig || '—' },
      ...(v.contractEndDate ? [{ label: 'Contract ends', value: v.contractEndDate }] : []),
      ...(target ? [{ label: 'Renewal window on the forward curve', value: `${target.label} forward at ${gbp(target.value)}/MWh` }] : []),
      ...(front && furthest ? [{ label: 'Forward curve shape', value: `front ${front.label} ${gbp(front.value)} → furthest ${furthest.label} ${gbp(furthest.value)} per MWh` }] : []),
      { label: 'Front-year power', value: fy.value === '—' ? '—' : `£${fy.value}/MWh` },
      { label: 'Day-ahead power', value: da.value === '—' ? '—' : `£${da.value}/MWh` },
      { label: 'NBP gas', value: gas.value === '—' ? '—' : `${gas.value} p/th` },
      { label: 'Brent', value: br.value === '—' ? '—' : `$${br.value}/bbl` },
    ],
  };

  return { tokens, lists: {}, summary };
}

const boundFields = [
  { key: 'clientName', read: (i: Record<string, unknown>) => getField(i as ClientProfile['inputs'], 'companyName'), write: (v: string) => ({ companyName: v }) },
  { key: 'contractEndDate', read: (i: Record<string, unknown>) => { const e = clientContractEnd(i as ClientProfile['inputs']); return e ? dateLong(e) : ''; }, write: (v: string) => ({ contractEnd: v }), readOnly: true },
];

export const procureAheadTemplate: ReportTemplate = {
  id: 'procure-ahead',
  kind: 'procure-ahead',
  name: 'Procure-Ahead Market Brief',
  description: 'A market brief with live power/gas/Brent figures and the UK power forward curve — with the client’s renewal period marked on the curve and the read tailored to their contract end.',
  accent: 'text-brand-greenDark',
  html: PROCURE_AHEAD_HTML,
  fields: FIELDS,
  groups: GROUPS,
  boundFields,
  seed,
  compute,
};
