import type { ReportInputs, ClientMeter } from './api';

// ── RFQ (Greenshift Lead Generation Form) — a BOUND VIEW over the client record ──
// The RFQ is the end-result the whole app feeds. So it isn't a parallel copy: each field
// is either (a) BOUND two-way to a canonical client-record field (edit it here, it updates
// everywhere — one source of truth), (b) DERIVED read-only from the record (meters etc.),
// or (c) an RFQ-only qualification answer stored on inputs.rfq (its canonical home). All
// information gathered across the app (website, transcripts, bills, emails) lands on the
// client record and surfaces here automatically.

export type RfqSource = 'manual' | 'transcript' | 'website' | 'profile' | 'na';
export interface RfqFieldValue { value: string; source: RfqSource }
export type RfqData = Record<string, RfqFieldValue>; // inputs.rfq — rfq-only answers + derived overrides

export interface RfqField { key: string; question: string; hint?: string; multiline?: boolean }
export interface RfqSection { title: string; fields: RfqField[] }

// The 9 sections of the form, verbatim from the supplied document.
export const RFQ_SECTIONS: RfqSection[] = [
  { title: 'Basic Information', fields: [
    { key: 'leadGenName', question: 'Lead Gen Name' },
    { key: 'companyName', question: 'Company Name' },
    { key: 'contactName', question: 'Contact Name' },
    { key: 'contactNumber', question: 'Contact Number' },
    { key: 'email', question: 'Email Address' },
    { key: 'businessType', question: 'Business Type' },
    { key: 'numberOfSites', question: 'Number of Sites' },
    { key: 'estimatedConsumption', question: 'Estimated Consumption (kWh)' },
    { key: 'meterProfiled', question: 'Is the meter profiled? (HH/NHH)' },
    { key: 'electricMpan', question: 'Electric MPAN' },
    { key: 'currentSupplier', question: 'Current Supplier' },
    { key: 'contractEndDate', question: 'Contract End Date' },
    { key: 'callTime', question: 'Time/Date for Call' },
  ] },
  { title: 'Access & Documents', fields: [
    { key: 'loaInPlace', question: 'LOA in place? (Yes/No)' },
    { key: 'billsAvailable', question: 'Are bills available/attached?' },
  ] },
  { title: 'Current Setup & Procurement', fields: [
    { key: 'procureMethod', question: 'How do you normally procure your energy?', multiline: true },
    { key: 'useBroker', question: 'Do you currently use a broker?' },
    { key: 'brokerWho', question: 'If yes – who are they?' },
    { key: 'brokerFrequency', question: 'How often do you hear from them?' },
  ] },
  { title: 'Market Awareness & Positioning', fields: [
    { key: 'marketKnowledge', question: 'What is your knowledge or understanding of the energy markets?', multiline: true },
    { key: 'reviewedContracts', question: 'Have you reviewed your energy contracts recently?', multiline: true },
    { key: 'reviewedKva', question: 'Have you ever reviewed your kVA capacity or standing charges? Do you understand how long the effects of recent market volatility will be felt?', multiline: true },
  ] },
  { title: 'Decision Making', fields: [
    { key: 'decisionMaker', question: 'Who makes the decision on contracts?' },
    { key: 'awareLooking', question: 'Are they aware you’re looking at prices?' },
    { key: 'decisionProcess', question: 'What is the decision-making process?', multiline: true },
    { key: 'decisionToday', question: 'If we present something strong, is it simple enough to get a decision there and then?', multiline: true },
    { key: 'timeline', question: 'If not, what would your timeline be?' },
  ] },
  { title: 'Current Performance', fields: [
    { key: 'worksWell', question: 'What works well with your current energy setup?', multiline: true },
    { key: 'bugBear', question: 'If you could pick one thing to improve in your current contracts or service, what would it be / what’s your biggest bug bear?', multiline: true },
    { key: 'supplierIssues', question: 'Have you had any issues with suppliers or billing?', multiline: true },
    { key: 'unexpectedCosts', question: 'Have you ever been hit with unexpected costs with previous contracts?', multiline: true },
  ] },
  { title: 'Pricing, Budget & Competition', fields: [
    { key: 'targetBudget', question: 'Do you have a target or budget in mind for your next contract?', multiline: true },
    { key: 'receivedPrices', question: 'Have you received any prices already?' },
    { key: 'pricesFromWho', question: 'If yes – from who?' },
    { key: 'expectingPrices', question: 'If no – are you expecting any?' },
  ] },
  { title: 'Risk & Strategy', fields: [
    { key: 'fixedVsMarket', question: 'Do you prefer fixed costs for certainty, or market-based pricing?', multiline: true },
    { key: 'contractLength', question: 'What contract length have you historically gone for? How long would you be open to fix prices for?', multiline: true },
  ] },
  { title: 'Urgency & Motivation', fields: [
    { key: 'signOffToday', question: 'If we presented a really good offer you’re happy with, could you obtain sign-off today? Are you aware prices move day-to-day and can only be guaranteed on the day?', multiline: true },
  ] },
];

export const RFQ_FIELDS: RfqField[] = RFQ_SECTIONS.flatMap((s) => s.fields);
export const RFQ_FIELD_KEYS: string[] = RFQ_FIELDS.map((f) => f.key);
export const rfqQuestion = (key: string): string => RFQ_FIELDS.find((f) => f.key === key)?.question ?? key;
export const rfqIsMultiline = (key: string): boolean => !!RFQ_FIELDS.find((f) => f.key === key)?.multiline;

export const RFQ_SOURCE_LABEL: Record<RfqSource, string> = {
  manual: 'Manual', transcript: 'Conversation', website: 'Website', profile: 'Client', na: 'N/A',
};

// ── record helpers ──
const field = (i: ReportInputs, k: string): string => String((i as Record<string, unknown>)[k] ?? '').trim();
const metersOf = (i: ReportInputs): ClientMeter[] => Array.isArray((i as Record<string, unknown>).meters) ? ((i as Record<string, unknown>).meters as ClientMeter[]) : [];
const rfqOf = (i: ReportInputs): RfqData => ((i as Record<string, unknown>).rfq as RfqData | undefined) ?? {};
const looksEmail = (s: string) => /@/.test(s);
const phoneOf = (i: ReportInputs) => field(i, 'telephone') || (!looksEmail(field(i, 'contact')) ? field(i, 'contact') : '');
const emailOf = (i: ReportInputs) => field(i, 'email') || (looksEmail(field(i, 'contact')) ? field(i, 'contact') : '');
const firstElecMpan = (i: ReportInputs) => (metersOf(i).find((m) => m.type === 'electric' && (m.mpan ?? '').trim())?.mpan ?? '').trim();
const siteCountOf = (i: ReportInputs) => {
  const n = new Set(metersOf(i).map((m) => (m.siteAddress ?? '').trim().toLowerCase()).filter(Boolean)).size;
  if (n) return String(n);
  const sites = field(i, 'sites');
  return sites ? String(sites.split(';').filter((s) => s.trim()).length) : '';
};
export const hasLoaDrafted = (i: ReportInputs): boolean => {
  const loa = (i as Record<string, unknown>).loa as Record<string, { value?: string }> | undefined;
  return !!loa && Object.values(loa).some((v) => (v?.value ?? '').trim());
};

// ── field bindings ──
type RfqBind =
  | { kind: 'client'; clientKey: string; read: (i: ReportInputs) => string }     // two-way to a flat client field
  | { kind: 'derived'; read: (i: ReportInputs) => string }                       // read-only from the record (meters …); editable → rfq override
  | { kind: 'rfq'; default?: (i: ReportInputs) => string };                      // canonical home on inputs.rfq
const C = (clientKey: string): RfqBind => ({ kind: 'client', clientKey, read: (i) => field(i, clientKey) });

export const RFQ_BIND: Record<string, RfqBind> = {
  companyName: C('companyName'),
  contactName: C('clientName'),
  contactNumber: { kind: 'client', clientKey: 'telephone', read: phoneOf },
  email: { kind: 'client', clientKey: 'email', read: emailOf },
  businessType: C('industry'),
  estimatedConsumption: C('consumption'),
  currentSupplier: C('currentSupplier'),
  contractEndDate: C('contractEnd'),
  electricMpan: { kind: 'derived', read: firstElecMpan },
  numberOfSites: { kind: 'derived', read: siteCountOf },
  loaInPlace: { kind: 'rfq', default: (i) => (hasLoaDrafted(i) ? 'Yes (LOA drafted)' : '') },
};
const bindOf = (key: string): RfqBind => RFQ_BIND[key] ?? { kind: 'rfq' };

export interface RfqFieldView { value: string; bound: boolean; derived: boolean; fromRecord: boolean; source?: RfqSource }
// The displayed value + provenance for a field, resolved against the live client record.
export function rfqFieldView(inputs: ReportInputs, key: string): RfqFieldView {
  const b = bindOf(key);
  if (b.kind === 'client') { const v = b.read(inputs); return { value: v, bound: true, derived: false, fromRecord: !!v, source: 'profile' }; }
  const rfq = rfqOf(inputs);
  if (b.kind === 'derived') {
    const ov = rfq[key]?.value?.trim();
    const dv = b.read(inputs);
    return { value: ov || dv, bound: false, derived: true, fromRecord: !ov && !!dv, source: ov ? rfq[key]?.source : (dv ? 'profile' : undefined) };
  }
  const e = rfq[key];
  const def = b.default?.(inputs) ?? '';
  const own = e?.value?.trim();
  return { value: own ? e.value : def, bound: false, derived: false, fromRecord: !own && !!def, source: own ? e?.source : (def ? 'profile' : undefined) };
}

export const rfqAllValues = (inputs: ReportInputs): Record<string, string> =>
  Object.fromEntries(RFQ_FIELDS.map((f) => [f.key, rfqFieldView(inputs, f.key).value]));

export function rfqCompleteness(inputs: ReportInputs): { known: number; total: number; missing: string[] } {
  const missing = RFQ_FIELDS.filter((f) => !rfqFieldView(inputs, f.key).value.trim()).map((f) => f.key);
  return { known: RFQ_FIELDS.length - missing.length, total: RFQ_FIELDS.length, missing };
}
export function sectionCompleteness(inputs: ReportInputs, section: RfqSection): { known: number; total: number } {
  const known = section.fields.filter((f) => rfqFieldView(inputs, f.key).value.trim()).length;
  return { known, total: section.fields.length };
}

// Write a single field — returns a NEW inputs object with the change routed to its canonical
// home (the client record for bound fields; inputs.rfq otherwise). One mutation point so the
// whole app stays in sync.
export function setRfqField(inputs: ReportInputs, key: string, value: string, source: RfqSource = 'manual'): ReportInputs {
  const b = bindOf(key);
  const next = { ...inputs } as Record<string, unknown>;
  if (b.kind === 'client') {
    next[b.clientKey] = value;
    // Keep the legacy combined `contact` field consistent — emailOf/phoneOf fall back to it,
    // so without this a cleared email/phone would be resurrected from a stale `contact`.
    if (b.clientKey === 'email' || b.clientKey === 'telephone') {
      const email = (b.clientKey === 'email' ? value : String(next.email ?? '')).trim();
      const tel = (b.clientKey === 'telephone' ? value : String(next.telephone ?? '')).trim();
      next.contact = email || tel;
    }
    return next as ReportInputs;
  }
  const rfq: RfqData = { ...rfqOf(inputs) };
  if (value.trim()) rfq[key] = { value, source }; else delete rfq[key];
  next.rfq = rfq;
  return next as ReportInputs;
}

// Apply an extracted field map (website / transcript) — bound fields enrich the client
// record, answers land on inputs.rfq — without clobbering anything already captured.
export function applyRfqExtract(inputs: ReportInputs, fields: Record<string, string>, source: RfqSource): { inputs: ReportInputs; filled: number } {
  let next = inputs;
  let filled = 0;
  for (const [key, raw] of Object.entries(fields)) {
    const v = (raw ?? '').trim();
    if (!v || !RFQ_FIELD_KEYS.includes(key)) continue;          // ignore unknown keys
    if (rfqFieldView(next, key).value.trim()) continue;         // don't overwrite an existing answer
    next = setRfqField(next, key, v, source);
    filled++;
  }
  return { inputs: next, filled };
}

export function rfqFilename(company: string): string {
  const safe = (company || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `rfq-${safe || 'client'}.docx`;
}

const INK = '2B2A2E';
const GREEN = '318300';
const MUTE = '6C6B70';
const LINE = 'E7E6E3';

// Build the internal RFQ as a real, editable Word document matching the Lead Generation
// Form: a title, a who/when strip, then one heading + a question→notes table per section.
export async function buildRfqDocx(values: Record<string, string>, meta: { company?: string; preparedBy?: string; date?: string }): Promise<Blob> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = docx;

  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const cellBorders = { top: border, bottom: border, left: border, right: border };

  const cell = (text: string, opts: { header?: boolean; width: number; bold?: boolean }) => new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    borders: cellBorders,
    shading: opts.header ? { fill: 'F2F2F2' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold || opts.header, color: INK, size: 19 })] })],
  });

  const sectionBlocks = RFQ_SECTIONS.flatMap((section) => {
    const rows = [
      new TableRow({ tableHeader: true, children: [cell('Question', { header: true, width: 55 }), cell('Comments / Notes', { header: true, width: 45 })] }),
      ...section.fields.map((f) => new TableRow({ children: [cell(f.question, { width: 55 }), cell((values[f.key] ?? '').trim(), { width: 45 })] })),
    ];
    return [
      new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 }, children: [new TextRun({ text: section.title, bold: true, color: GREEN, size: 24 })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    ];
  });

  const doc = new Document({
    creator: 'Green Shift Energy',
    title: 'Greenshift Lead Generation Form',
    sections: [{
      properties: {},
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Greenshift Lead Generation Form', bold: true, color: INK, size: 36 })] }),
        new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: 'Internal use only — qualification record for the pricing specialist.', italics: true, color: MUTE, size: 18 })] }),
        new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: [meta.company && `Client: ${meta.company}`, meta.preparedBy && `Lead gen: ${meta.preparedBy}`, `Date: ${meta.date || new Date().toLocaleDateString('en-GB')}`].filter(Boolean).join('     '), color: MUTE, size: 18 })] }),
        ...sectionBlocks,
      ],
    }],
  });
  return Packer.toBlob(doc);
}
