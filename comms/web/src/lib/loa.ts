import type { ReportInputs, ClientMeter } from './api';

// ── Letter of Authority field model ──
// The canonical customer fields the LOA needs. Values + provenance are stored on
// the client under inputs.loa; customer fuel/services under inputs.customerVariables.

export type LoaSource = 'manual' | 'transcript' | 'website' | 'companiesHouse' | 'profile';
export interface LoaFieldValue { value: string; source: LoaSource }
export type LoaData = Record<string, LoaFieldValue>;

export type Fuel = 'gas' | 'electric' | 'both' | '';
// Per-client "what they buy" — the fuel they purchase. Stored on
// inputs.customerVariables; surfaced in the client record and used by the LOA
// auto-population (N/A the meter they don't have).
export interface CustomerVariables { fuel?: Fuel }

export const LOA_FIELDS: { key: string; label: string; group: string; hint?: string }[] = [
  { key: 'customerName', label: 'Name of Customer', group: 'Company', hint: 'Full legal / trading name' },
  { key: 'registeredNo', label: 'Registered no', group: 'Company', hint: 'Companies House number (if a company)' },
  { key: 'businessAddress', label: 'Business address', group: 'Company' },
  { key: 'postcode', label: 'Postcode', group: 'Company' },
  { key: 'telephone', label: 'Telephone no', group: 'Contact' },
  { key: 'authorisedRep', label: 'Authorised representative', group: 'Contact' },
  { key: 'email', label: 'Email address', group: 'Contact' },
  { key: 'mpan', label: 'MPAN (electricity)', group: 'Meters' },
  { key: 'mpr', label: 'MPR / MPRN (gas)', group: 'Meters' },
  { key: 'siteAddresses', label: 'Site address(es)', group: 'Meters' },
  { key: 'signatoryName', label: 'Signatory — print name', group: 'Signatory' },
  { key: 'position', label: 'Position', group: 'Signatory' },
  { key: 'signatoryEmail', label: 'Signatory email', group: 'Signatory' },
];
export const LOA_GROUPS = ['Company', 'Contact', 'Meters', 'Signatory'];

export const SOURCE_LABEL: Record<LoaSource, string> = {
  manual: 'Manual', transcript: 'Conversation', website: 'Website', companiesHouse: 'Companies House', profile: 'Client',
};

const looksEmail = (s: string) => /@/.test(s);
const field = (inputs: ReportInputs, key: string): string => String((inputs as Record<string, unknown>)[key] ?? '').trim();
const metersOf = (inputs: ReportInputs): ClientMeter[] => Array.isArray((inputs as Record<string, unknown>).meters) ? ((inputs as Record<string, unknown>).meters as ClientMeter[]) : [];
const sitesOf = (meters: ClientMeter[]): string => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const m of meters) { const s = (m.siteAddress ?? '').trim(); const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out.join('; ');
};

// Seed LOA fields from the comprehensive client profile, so the builder starts as
// complete as possible. Saved inputs.loa values win; these are the fallbacks.
// Auto-fills MPAN/MPRN from the meters, "N/A" for a fuel they don't buy, and the
// site address from the meters / business address.
export function deriveLoaFromClient(inputs: ReportInputs): LoaData {
  const saved = ((inputs as Record<string, unknown>).loa as LoaData | undefined) ?? {};
  const out: LoaData = { ...saved };
  const put = (key: string, value: string | undefined, source: LoaSource) => {
    const cur = out[key];
    // Keep values another source owns (manual edits, Companies House, conversation
    // pulls); REFRESH anything auto-derived from the client record so newly-gathered
    // data (uploads / transcripts) flows in automatically on re-entry — and if a
    // record field was cleared, un-derive the stale profile value too.
    if (!value || !value.trim()) { if (cur?.source === 'profile') delete out[key]; return; }
    if (cur?.value?.trim() && cur.source !== 'profile') return;
    out[key] = { value: value.trim(), source };
  };
  const contact = field(inputs, 'contact');
  const email = field(inputs, 'email') || (looksEmail(contact) ? contact : '');
  const phone = field(inputs, 'telephone') || (!looksEmail(contact) ? contact : '');
  const meters = metersOf(inputs);
  const fuel = ((inputs as Record<string, unknown>).customerVariables as CustomerVariables | undefined)?.fuel;

  put('customerName', field(inputs, 'companyName'), 'profile');
  put('registeredNo', field(inputs, 'registeredNo'), 'profile');
  put('businessAddress', field(inputs, 'businessAddress'), 'profile');
  put('postcode', field(inputs, 'postcode'), 'profile');
  put('telephone', phone, 'profile');
  put('authorisedRep', field(inputs, 'clientName'), 'profile');
  put('email', email, 'profile');
  put('signatoryName', field(inputs, 'clientName'), 'profile');
  put('position', field(inputs, 'position'), 'profile');
  put('signatoryEmail', email, 'profile');

  // Meters → MPAN (electricity) / MPRN (gas), with N/A for a fuel they don't buy.
  const elec = meters.find((m) => m.type === 'electric' && (m.mpan ?? '').trim());
  const gas = meters.find((m) => m.type === 'gas' && (m.mprn ?? '').trim());
  if (elec?.mpan) put('mpan', elec.mpan, 'profile');
  if (gas?.mprn) put('mpr', gas.mprn, 'profile');
  if (fuel === 'gas') put('mpan', 'N/A', 'profile'); // no electricity
  if (fuel === 'electric') put('mpr', 'N/A', 'profile'); // no gas

  // Site address: the meters' sites, else the sites field, else the business address.
  put('siteAddresses', sitesOf(meters) || field(inputs, 'sites') || field(inputs, 'businessAddress'), 'profile');
  return out;
}

export const loaValues = (data: LoaData): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));

export function loaCompleteness(data: LoaData): { known: number; total: number; missing: string[] } {
  const missing = LOA_FIELDS.filter((f) => !data[f.key]?.value?.trim()).map((f) => f.key);
  return { known: LOA_FIELDS.length - missing.length, total: LOA_FIELDS.length, missing };
}

// ── LOA template geometry (the real 2-page A4 template, 595×842pt, top-left origin) ──
// One unified position map drives BOTH the on-screen visual editor and the pdf-lib
// fill, so what you drag/edit is what lands in the PDF. `x,y` is the top-left of the
// value (y is the label line top); `maxWidth` caps single-line text (it shrinks to
// fit) and wraps multi-line. Per-page background images: /loa-page-{1,2}.png.
export const LOA_PAGE_W = 595;
export const LOA_PAGE_H = 842;
const FONT_SIZE = 10;
export const LOA_LINE_H = 13;
// `vy` = the value's first-line text BASELINE (pt from top). Page-1 single-line
// values are vertically CENTRED in their table cell (cell centre + cap/2);
// multi-line values start near the top of their (tall) cell; page-2 values sit on
// the printed dotted line. Measured from the real template so it matches the broker
// block's centring.
export interface LoaFieldPos { page: 1 | 2; x: number; vy: number; maxWidth: number; multiline?: boolean; maxLines?: number }
export const LOA_FIELD_POS: Record<string, LoaFieldPos> = {
  // page 1 — customer details. The value cell spans x≈200.6→538.8; values sit at
  // x=212 (~11pt of left padding off the divider, matching the pre-printed text)
  // and widths are capped to stay inside the right border (≤~533).
  customerName: { page: 1, x: 212, vy: 186.8, maxWidth: 230 }, // "(I/we/us)" sits ~x=456
  registeredNo: { page: 1, x: 212, vy: 218.3, maxWidth: 321 },
  businessAddress: { page: 1, x: 212, vy: 247, maxWidth: 321, multiline: true, maxLines: 3 },
  postcode: { page: 1, x: 212, vy: 302.8, maxWidth: 200 },
  telephone: { page: 1, x: 212, vy: 333.8, maxWidth: 250 },
  authorisedRep: { page: 1, x: 212, vy: 365.8, maxWidth: 321 },
  email: { page: 1, x: 212, vy: 396.8, maxWidth: 321 },
  mpan: { page: 1, x: 212, vy: 428.8, maxWidth: 250 },
  mpr: { page: 1, x: 212, vy: 460.3, maxWidth: 250 },
  siteAddresses: { page: 1, x: 212, vy: 489, maxWidth: 321, multiline: true, maxLines: 4 },
  // page 2 — signature block. Values sit JUST ABOVE the printed dotted lines (so the
  // line underlines the text) — measured label baselines are 586.8 / 649.9 / 698.7,
  // values placed ~4-5pt higher so they read as written-on-the-line, not cut through.
  signatoryName: { page: 2, x: 363, vy: 582, maxWidth: 175 },
  position: { page: 2, x: 82, vy: 645, maxWidth: 200 },
  signatoryEmail: { page: 2, x: 365, vy: 645, maxWidth: 175 },
  dated: { page: 2, x: 85, vy: 694, maxWidth: 200 },
};

export const todayLong = (): string => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
// `dated` defaults to today; the editor seeds it but the fill is the safety net.
export const loaValueFor = (values: Record<string, string>, key: string): string =>
  key === 'dated' ? ((values.dated ?? '').trim() || todayLong()) : (values[key] ?? '').trim();

function wrap(text: string, font: import('pdf-lib').PDFFont, size: number, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

// Returns the filled PDF bytes. `positions` overrides any field's {x,y} (drag).
export async function fillLoaPdf(
  values: Record<string, string>,
  opts?: { positions?: Record<string, { x: number; y: number }>; templateUrl?: string },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const bytes = await (await fetch(opts?.templateUrl ?? '/loa-template.pdf')).arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const ink = rgb(0.09, 0.09, 0.11);

  for (const [key, pos] of Object.entries(LOA_FIELD_POS)) {
    const v = loaValueFor(values, key);
    const page = pages[pos.page - 1];
    if (!v || !page) continue;
    const ov = opts?.positions?.[key];
    const x = ov ? ov.x : pos.x;
    const vy = ov ? ov.y : pos.vy; // value baseline (pt from top)
    if (pos.multiline) {
      wrap(v, font, FONT_SIZE, pos.maxWidth, pos.maxLines ?? 3)
        .forEach((line, i) => page.drawText(line, { x, y: LOA_PAGE_H - (vy + i * LOA_LINE_H), size: FONT_SIZE, font, color: ink }));
    } else {
      // Shrink single-line text to fit its column so nothing overruns the box.
      let size = FONT_SIZE;
      while (size > 7 && font.widthOfTextAtSize(v, size) > pos.maxWidth) size -= 0.5;
      page.drawText(v, { x, y: LOA_PAGE_H - vy, size, font, color: ink });
    }
  }
  return pdf.save();
}

export function loaFilename(customerName: string): string {
  const safe = (customerName || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `loa-${safe || 'customer'}.pdf`;
}
