import type { ReportInputs, ClientMeter, ClientIntakeResult } from './api';
import type { CustomerVariables } from './loa';

// The comprehensive per-client record. Everything lives on `inputs` (schemaless
// jsonb) — the headline metrics plus a much wider captured data set. Blank fields
// aren't shown by default but are all listed here so the hub can offer to add them.

export type { ClientMeter } from './api';

export const CLIENT_FIELD_GROUPS: { group: string; fields: { key: keyof ReportInputs | string; label: string; placeholder?: string }[] }[] = [
  { group: 'Company', fields: [
    { key: 'companyName', label: 'Company name', placeholder: 'Acme Manufacturing Ltd' },
    { key: 'registeredNo', label: 'Companies House no.', placeholder: '01234567' },
    { key: 'businessAddress', label: 'Business address', placeholder: '12 Industrial Way, Leeds' },
    { key: 'postcode', label: 'Postcode', placeholder: 'LS1 4AB' },
    { key: 'industry', label: 'Industry', placeholder: 'Food manufacturing' },
    { key: 'website', label: 'Website', placeholder: 'acme.co.uk' },
  ] },
  { group: 'Contact', fields: [
    { key: 'clientName', label: 'Contact name', placeholder: 'Jane Smith' },
    { key: 'position', label: 'Position', placeholder: 'Operations Director' },
    { key: 'email', label: 'Email', placeholder: 'jane@acme.co.uk' },
    { key: 'telephone', label: 'Telephone', placeholder: '0113 555 1212' },
  ] },
  { group: 'Current position', fields: [
    { key: 'currentSupplier', label: 'Current supplier', placeholder: 'British Gas' },
    { key: 'currentProduct', label: 'Product / tariff', placeholder: 'Out-of-contract / deemed' },
    { key: 'currentUnitRate', label: 'Unit rate (p/kWh)', placeholder: '34.50' },
    { key: 'currentStanding', label: 'Standing charge (p/day)', placeholder: '95.00' },
    { key: 'contractEnd', label: 'Contract end', placeholder: 'Sep 2026' },
    { key: 'consumption', label: 'Annual consumption', placeholder: '450,000 kWh' },
  ] },
];
export const ALL_CLIENT_FIELDS = CLIENT_FIELD_GROUPS.flatMap((g) => g.fields);

export const getField = (inputs: ReportInputs, key: string): string =>
  String((inputs as Record<string, unknown>)[key] ?? '').trim();

export const getMeters = (inputs: ReportInputs): ClientMeter[] =>
  Array.isArray((inputs as Record<string, unknown>).meters) ? ((inputs as Record<string, unknown>).meters as ClientMeter[]) : [];

export const getVars = (inputs: ReportInputs): CustomerVariables =>
  ((inputs as Record<string, unknown>).customerVariables as CustomerVariables | undefined) ?? {};

// Unique site addresses across all meters → the "sites" summary string.
export function meterSites(meters: ClientMeter[]): string {
  const seen = new Set<string>(); const out: string[] = [];
  for (const m of meters) { const s = (m.siteAddress ?? '').trim(); const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out.join('; ');
}

const looksEmail = (s: string) => /@/.test(s);

// Map a comprehensive intake result onto the client `inputs`, merged over existing
// values (existing non-blank values win, so manual edits aren't clobbered).
export function mergeIntakeIntoInputs(prev: ReportInputs, r: ClientIntakeResult): ReportInputs {
  const next = { ...prev } as Record<string, unknown>;
  const put = (key: string, val: string | undefined) => { if (val && val.trim() && !String(next[key] ?? '').trim()) next[key] = val.trim(); };
  put('companyName', r.companyName);
  put('clientName', r.contactName);
  put('position', r.position);
  put('email', r.email);
  put('telephone', r.telephone);
  put('contact', r.email || r.telephone); // legacy combined field used by reports/LOA
  put('registeredNo', r.registeredNo);
  put('businessAddress', r.businessAddress);
  put('postcode', r.postcode);
  put('industry', r.industry);
  put('website', r.websiteUrl);
  put('companySummary', r.companySummary);
  put('currentSupplier', r.currentSupplier);
  put('contractEnd', r.contractEnd);
  put('consumption', r.consumption);
  // meters (replace if we found any and none stored yet)
  if (r.meters.length && !getMeters(prev).length) next.meters = r.meters;
  put('sites', meterSites(r.meters));
  // what they buy (fuel) — auto-extracted; existing choice wins
  const cv = getVars(prev);
  next.customerVariables = { fuel: cv.fuel || r.fuel } as CustomerVariables;
  void looksEmail;
  return next as ReportInputs;
}

// A short, human label for a meter row.
export function meterLabel(m: ClientMeter): string {
  const num = m.type === 'gas' ? m.mprn : m.mpan;
  return `${m.type === 'gas' ? 'Gas' : 'Electric'}${num ? ` · ${num}` : ''}`;
}
