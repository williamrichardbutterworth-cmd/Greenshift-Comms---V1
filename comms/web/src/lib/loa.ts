import type { ReportInputs } from './api';

// ── Letter of Authority field model ──
// The canonical customer fields the LOA needs. Values + provenance are stored on
// the client under inputs.loa; customer fuel/services under inputs.customerVariables.

export type LoaSource = 'manual' | 'transcript' | 'website' | 'companiesHouse' | 'profile';
export interface LoaFieldValue { value: string; source: LoaSource }
export type LoaData = Record<string, LoaFieldValue>;

export type Fuel = 'gas' | 'electric' | 'both' | '';
export interface CustomerVariables { fuel?: Fuel; services?: string[] }

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

// Seed LOA fields from what the client profile already holds, so the builder
// starts pre-filled. Saved inputs.loa values win; these are the fallbacks.
export function deriveLoaFromClient(inputs: ReportInputs): LoaData {
  const saved = ((inputs as Record<string, unknown>).loa as LoaData | undefined) ?? {};
  const out: LoaData = { ...saved };
  const put = (key: string, value: string | undefined, source: LoaSource) => {
    if (!value || !value.trim()) return;
    if (out[key]?.value?.trim()) return; // don't clobber a saved/edited value
    out[key] = { value: value.trim(), source };
  };
  put('customerName', inputs.companyName, 'profile');
  put('authorisedRep', inputs.clientName, 'profile');
  put('signatoryName', inputs.clientName, 'profile');
  put('siteAddresses', inputs.sites, 'profile');
  if (inputs.contact && looksEmail(inputs.contact)) { put('email', inputs.contact, 'profile'); put('signatoryEmail', inputs.contact, 'profile'); }
  else put('telephone', inputs.contact, 'profile');
  return out;
}

export const loaValues = (data: LoaData): Record<string, string> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));

export function loaCompleteness(data: LoaData): { known: number; total: number; missing: string[] } {
  const missing = LOA_FIELDS.filter((f) => !data[f.key]?.value?.trim()).map((f) => f.key);
  return { known: LOA_FIELDS.length - missing.length, total: LOA_FIELDS.length, missing };
}

// ── PDF fill (pdf-lib overlay on the actual stored template) ──
// Coordinates measured from the real template (A4 595×842pt, top-left origin):
// value column x≈200 on page 1, signature line positions on page 2.
const PAGE_H = 842;
// page 1 fields: pymupdf label top-y → we draw the value on that line at x=200.
const P1: Record<string, { y0: number; multiline?: boolean; maxLines?: number }> = {
  customerName: { y0: 188 }, registeredNo: { y0: 219 },
  businessAddress: { y0: 243, multiline: true, maxLines: 3 }, postcode: { y0: 303 },
  telephone: { y0: 335 }, authorisedRep: { y0: 367 }, email: { y0: 398 },
  mpan: { y0: 430 }, mpr: { y0: 461 }, siteAddresses: { y0: 484, multiline: true, maxLines: 4 },
};
// page 2 signature line: {x, y0}
const P2: Record<string, { x: number; y0: number }> = {
  signatoryName: { x: 363, y0: 577 }, position: { x: 82, y0: 640 },
  signatoryEmail: { x: 365, y0: 640 }, dated: { x: 85, y0: 689 },
};
const P1_X = 200;
const P1_MAXW = 350;
const FONT_SIZE = 10;
const LINE_H = 13;

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

// Returns the filled PDF bytes. `dated` defaults to today (en-GB long).
export async function fillLoaPdf(values: Record<string, string>, templateUrl = '/loa-template.pdf'): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const bytes = await (await fetch(templateUrl)).arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const [page1, page2] = pdf.getPages();
  const ink = rgb(0.09, 0.09, 0.11);
  const draw = (page: import('pdf-lib').PDFPage, text: string, x: number, y0: number) =>
    page.drawText(text, { x, y: PAGE_H - (y0 + 9), size: FONT_SIZE, font, color: ink });

  for (const [key, pos] of Object.entries(P1)) {
    const v = (values[key] ?? '').trim();
    if (!v || !page1) continue;
    if (pos.multiline) {
      wrap(v, font, FONT_SIZE, P1_MAXW, pos.maxLines ?? 3).forEach((line, i) => draw(page1, line, P1_X, pos.y0 + i * LINE_H));
    } else {
      draw(page1, v, P1_X, pos.y0);
    }
  }
  const dated = (values.dated ?? '').trim() || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  for (const [key, pos] of Object.entries(P2)) {
    const v = key === 'dated' ? dated : (values[key] ?? '').trim();
    if (!v || !page2) continue;
    draw(page2, v, pos.x, pos.y0);
  }
  return pdf.save();
}

export function loaFilename(customerName: string): string {
  const safe = (customerName || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `loa-${safe || 'customer'}.pdf`;
}
