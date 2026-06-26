import { config, companiesHouseConfigured } from '../config';
import { fetchJson } from '../lib/http';

// UK Companies House lookup — verify a customer against the live company
// register and harvest the genuine registered name / number / office address
// for the Letter of Authority. Graceful-degrades to "not configured" (manual
// entry) when COMPANIES_HOUSE_API_KEY is unset. Never throws.

export interface ChCompanySummary {
  companyNumber: string;
  title: string;
  status: string;        // 'active' | 'dissolved' | ...
  type: string;          // 'ltd' | 'plc' | ...
  addressSnippet: string;
  incorporatedOn: string;
}
export interface ChCompanyProfile extends ChCompanySummary {
  registeredAddress: string;
  postcode: string;
  sicCodes: string[];
}

// Companies House uses HTTP Basic auth with the API key as the username and an
// EMPTY password.
function authHeader(): Record<string, string> {
  const basic = Buffer.from(`${config.companiesHouseApiKey}:`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

function joinAddress(a: Record<string, string | undefined> | undefined): { line: string; postcode: string } {
  if (!a) return { line: '', postcode: '' };
  const parts = [a.address_line_1, a.address_line_2, a.locality, a.region, a.country].filter(Boolean);
  return { line: parts.join(', '), postcode: a.postal_code ?? '' };
}

interface ChSearchRow {
  company_number?: string; title?: string; company_status?: string; company_type?: string;
  address_snippet?: string; date_of_creation?: string;
}

export async function searchCompanies(q: string): Promise<{ items: ChCompanySummary[]; provider: string; error?: string }> {
  if (!q.trim()) return { items: [], provider: 'none' };
  if (!companiesHouseConfigured()) return { items: [], provider: 'none', error: 'Companies House lookup isn’t configured.' };
  try {
    const res = await fetchJson<{ items?: ChSearchRow[] }>(
      `${config.companiesHouseBaseUrl}/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`,
      { headers: authHeader() },
    );
    const items = (res.items ?? []).filter((r) => r.company_number).map((r) => ({
      companyNumber: r.company_number ?? '',
      title: r.title ?? '',
      status: r.company_status ?? '',
      type: r.company_type ?? '',
      addressSnippet: r.address_snippet ?? '',
      incorporatedOn: r.date_of_creation ?? '',
    }));
    return { items, provider: 'companies-house' };
  } catch (e) {
    return { items: [], provider: 'error', error: (e as Error).message };
  }
}

interface ChProfileRow {
  company_name?: string; company_number?: string; company_status?: string; type?: string;
  date_of_creation?: string; sic_codes?: string[];
  registered_office_address?: Record<string, string | undefined>;
}

export async function getCompany(number: string): Promise<{ company: ChCompanyProfile | null; provider: string; error?: string }> {
  if (!number.trim()) return { company: null, provider: 'none' };
  if (!companiesHouseConfigured()) return { company: null, provider: 'none', error: 'Companies House lookup isn’t configured.' };
  try {
    const r = await fetchJson<ChProfileRow>(
      `${config.companiesHouseBaseUrl}/company/${encodeURIComponent(number.trim())}`,
      { headers: authHeader() },
    );
    const addr = joinAddress(r.registered_office_address);
    return {
      company: {
        companyNumber: r.company_number ?? number,
        title: r.company_name ?? '',
        status: r.company_status ?? '',
        type: r.type ?? '',
        addressSnippet: addr.line,
        incorporatedOn: r.date_of_creation ?? '',
        registeredAddress: addr.line,
        postcode: addr.postcode,
        sicCodes: Array.isArray(r.sic_codes) ? r.sic_codes : [],
      },
      provider: 'companies-house',
    };
  } catch (e) {
    // 404 (unknown number) throws here — treat as "not found", not an error.
    const msg = (e as Error).message;
    if (/HTTP 404/.test(msg)) return { company: null, provider: 'companies-house' };
    return { company: null, provider: 'error', error: msg };
  }
}
