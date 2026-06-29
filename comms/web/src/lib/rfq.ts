import type { ReportInputs, ClientMeter } from './api';

// ── RFQ (Greenshift Lead Generation Form) field model ──
// The internal qualification form handed to the pricing specialist. Mirrors the LOA
// pattern: per-field value + provenance, seeded from the client record and refreshed
// from conversations / the website, persisted on the client under inputs.rfq.

export type RfqSource = 'manual' | 'transcript' | 'website' | 'profile';
export interface RfqFieldValue { value: string; source: RfqSource }
export type RfqData = Record<string, RfqFieldValue>;

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

export const RFQ_SOURCE_LABEL: Record<RfqSource, string> = {
  manual: 'Manual', transcript: 'Conversation', website: 'Website', profile: 'Client',
};

const looksEmail = (s: string) => /@/.test(s);
const field = (inputs: ReportInputs, key: string): string => String((inputs as Record<string, unknown>)[key] ?? '').trim();
const metersOf = (inputs: ReportInputs): ClientMeter[] => Array.isArray((inputs as Record<string, unknown>).meters) ? ((inputs as Record<string, unknown>).meters as ClientMeter[]) : [];

// Seed RFQ answers from the client record — the Basic Information block is filled
// automatically; the qualification questions stay blank for the call. Saved inputs.rfq
// values win (manual / transcript / website pulls aren't clobbered); profile-derived
// fields refresh on re-entry so newly-gathered client data flows in (and un-derive if a
// record field was cleared) — exactly the LOA ownership model.
export function deriveRfqFromClient(inputs: ReportInputs): RfqData {
  const saved = ((inputs as Record<string, unknown>).rfq as RfqData | undefined) ?? {};
  const out: RfqData = { ...saved };
  const put = (key: string, value: string | undefined) => {
    const cur = out[key];
    if (!value || !value.trim()) { if (cur?.source === 'profile') delete out[key]; return; }
    if (cur?.value?.trim() && cur.source !== 'profile') return;
    out[key] = { value: value.trim(), source: 'profile' };
  };
  const contact = field(inputs, 'contact');
  const email = field(inputs, 'email') || (looksEmail(contact) ? contact : '');
  const phone = field(inputs, 'telephone') || (!looksEmail(contact) ? contact : '');
  const meters = metersOf(inputs);
  const sites = new Set(meters.map((m) => (m.siteAddress ?? '').trim().toLowerCase()).filter(Boolean)).size;
  const elec = meters.find((m) => m.type === 'electric' && (m.mpan ?? '').trim());
  // earliest meter contract end, else the headline field
  const meterEnd = meters.map((m) => (m.contractEnd ?? '').trim()).filter(Boolean)[0];

  put('companyName', field(inputs, 'companyName'));
  put('contactName', field(inputs, 'clientName'));
  put('contactNumber', phone);
  put('email', email);
  put('businessType', field(inputs, 'industry'));
  put('numberOfSites', sites ? String(sites) : (field(inputs, 'sites') ? String(field(inputs, 'sites').split(';').filter(Boolean).length) : ''));
  put('estimatedConsumption', field(inputs, 'consumption'));
  put('electricMpan', elec?.mpan ?? '');
  put('currentSupplier', field(inputs, 'currentSupplier'));
  put('contractEndDate', meterEnd || field(inputs, 'contractEnd'));
  // LOA in place if a signed/drafted LOA exists on the record. Always call put (with ''
  // when none) so a profile-derived 'Drafted' un-derives if the LOA is later cleared.
  const loa = (inputs as Record<string, unknown>).loa as Record<string, { value?: string }> | undefined;
  const hasLoa = !!loa && Object.values(loa).some((v) => (v?.value ?? '').trim());
  put('loaInPlace', hasLoa ? 'Drafted' : '');
  return out;
}

export const rfqValues = (data: RfqData): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));

export function rfqCompleteness(data: RfqData): { known: number; total: number; missing: string[] } {
  const missing = RFQ_FIELDS.filter((f) => !data[f.key]?.value?.trim()).map((f) => f.key);
  return { known: RFQ_FIELDS.length - missing.length, total: RFQ_FIELDS.length, missing };
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
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold || opts.header, color: opts.header ? INK : INK, size: 19 })] })],
  });

  const sectionBlocks = RFQ_SECTIONS.flatMap((section) => {
    const rows = [
      new TableRow({ tableHeader: true, children: [cell('Question', { header: true, width: 55 }), cell('Comments / Notes', { header: true, width: 45 })] }),
      ...section.fields.map((f) => new TableRow({ children: [
        cell(f.question, { width: 55 }),
        cell((values[f.key] ?? '').trim(), { width: 45 }),
      ] })),
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
        new Paragraph({ spacing: { after: 40 }, children: [
          new TextRun({ text: 'Internal use only — qualification record for the pricing specialist.', italics: true, color: MUTE, size: 18 }),
        ] }),
        new Paragraph({ spacing: { after: 160 }, children: [
          new TextRun({ text: [meta.company && `Client: ${meta.company}`, meta.preparedBy && `Lead gen: ${meta.preparedBy}`, `Date: ${meta.date || new Date().toLocaleDateString('en-GB')}`].filter(Boolean).join('     '), color: MUTE, size: 18 }),
        ] }),
        ...sectionBlocks,
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  return blob;
}
