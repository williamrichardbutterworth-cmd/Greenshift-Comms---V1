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

// ── LOA template geometry (the real 2-page A4 template, 595×842pt, top-left origin) ──
// One unified position map drives BOTH the on-screen visual editor and the pdf-lib
// fill, so what you drag/edit is what lands in the PDF. `x,y` is the top-left of the
// value (y is the label line top); `maxWidth` caps single-line text (it shrinks to
// fit) and wraps multi-line. Per-page background images: /loa-page-{1,2}.png.
export const LOA_PAGE_W = 595;
export const LOA_PAGE_H = 842;
const FONT_SIZE = 10;
const LINE_H = 13;
const TEXT_BASELINE_DY = 9; // value baseline sits ~9pt below the label-line top

export interface LoaFieldPos { page: 1 | 2; x: number; y: number; maxWidth: number; multiline?: boolean; maxLines?: number }
export const LOA_FIELD_POS: Record<string, LoaFieldPos> = {
  // page 1 — customer details (value column x≈200)
  customerName: { page: 1, x: 200, y: 188, maxWidth: 235 }, // "(I/we/us)" sits ~x=445
  registeredNo: { page: 1, x: 200, y: 219, maxWidth: 360 },
  businessAddress: { page: 1, x: 200, y: 243, maxWidth: 355, multiline: true, maxLines: 3 },
  postcode: { page: 1, x: 200, y: 303, maxWidth: 200 },
  telephone: { page: 1, x: 200, y: 335, maxWidth: 250 },
  authorisedRep: { page: 1, x: 200, y: 367, maxWidth: 355 },
  email: { page: 1, x: 200, y: 398, maxWidth: 355 },
  mpan: { page: 1, x: 200, y: 430, maxWidth: 250 },
  mpr: { page: 1, x: 200, y: 461, maxWidth: 250 },
  siteAddresses: { page: 1, x: 200, y: 484, maxWidth: 355, multiline: true, maxLines: 4 },
  // page 2 — signature block
  signatoryName: { page: 2, x: 363, y: 577, maxWidth: 175 },
  position: { page: 2, x: 82, y: 640, maxWidth: 200 },
  signatoryEmail: { page: 2, x: 365, y: 640, maxWidth: 175 },
  dated: { page: 2, x: 85, y: 689, maxWidth: 200 },
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
    const y0 = ov ? ov.y : pos.y;
    if (pos.multiline) {
      wrap(v, font, FONT_SIZE, pos.maxWidth, pos.maxLines ?? 3)
        .forEach((line, i) => page.drawText(line, { x, y: LOA_PAGE_H - (y0 + TEXT_BASELINE_DY + i * LINE_H), size: FONT_SIZE, font, color: ink }));
    } else {
      // Shrink single-line text to fit its column so nothing overruns the box.
      let size = FONT_SIZE;
      while (size > 7 && font.widthOfTextAtSize(v, size) > pos.maxWidth) size -= 0.5;
      page.drawText(v, { x, y: LOA_PAGE_H - (y0 + TEXT_BASELINE_DY), size, font, color: ink });
    }
  }
  return pdf.save();
}

export function loaFilename(customerName: string): string {
  const safe = (customerName || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `loa-${safe || 'customer'}.pdf`;
}
