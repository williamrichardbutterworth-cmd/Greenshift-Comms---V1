import type { ReportInputs, ClientMeter } from './api';
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

// NOTE: intake/log-call results are merged into the client record SERVER-SIDE
// (comms/server/src/services/clientCapture.ts) against a fresh read — the old
// browser-side mergeIntakeIntoInputs was removed so a stale snapshot can never
// clobber concurrent edits.

// A short, human label for a meter row.
export function meterLabel(m: ClientMeter): string {
  const num = m.type === 'gas' ? m.mprn : m.mpan;
  return `${m.type === 'gas' ? 'Gas' : 'Electric'}${num ? ` · ${num}` : ''}`;
}
