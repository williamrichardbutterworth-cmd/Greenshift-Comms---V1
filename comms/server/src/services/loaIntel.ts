import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { fetchText } from '../lib/http';
import { loaExtractPrompt, LOA_FIELD_KEYS } from './prompts';

// Harvest Letter-of-Authority details from free text (call transcripts, notes,
// uploaded docs) and from a company website. Follows the house "never throw,
// degrade to provider:'error'/'none'" contract; empty string === unknown.

export type LoaFuel = 'gas' | 'electric' | 'both' | '';
export interface LoaExtract {
  fields: Record<string, string>;
  fuel: LoaFuel;
  services: string[];
  companySummary: string;
  provider: string;
  error?: string;
}

const EMPTY: LoaExtract = { fields: {}, fuel: '', services: [], companySummary: '', provider: 'none' };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const FUELS: LoaFuel[] = ['gas', 'electric', 'both'];

function coerce(raw: { fields?: Record<string, unknown>; fuel?: unknown; services?: unknown; companySummary?: unknown }, provider: string): LoaExtract {
  const fields: Record<string, string> = {};
  for (const k of LOA_FIELD_KEYS) { const v = str(raw.fields?.[k]); if (v) fields[k] = v; }
  const fuelRaw = str(raw.fuel).toLowerCase() as LoaFuel;
  return {
    fields,
    fuel: FUELS.includes(fuelRaw) ? fuelRaw : '',
    services: Array.isArray(raw.services) ? raw.services.map(str).filter(Boolean).slice(0, 8) : [],
    companySummary: str(raw.companySummary).slice(0, 800),
    provider,
  };
}

export async function extractLoaFields(text: string, current?: Record<string, string>, fromWebsite = false): Promise<LoaExtract> {
  if (!text.trim()) return EMPTY;
  if (!aiConfigured()) return { ...EMPTY, error: 'Automatic extraction isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = loaExtractPrompt(text, current, fromWebsite);
    const raw = await ai.generateJSON<{ fields?: Record<string, unknown>; fuel?: unknown; services?: unknown; companySummary?: unknown }>({ system, prompt, maxTokens: 1500 });
    return coerce(raw ?? {}, ai.name);
  } catch (e) {
    return { ...EMPTY, provider: 'error', error: (e as Error).message };
  }
}

// Strip a fetched HTML page down to readable text for the AI to summarise.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export async function scrapeCompanyWebsite(url: string, current?: Record<string, string>): Promise<LoaExtract & { url: string }> {
  const target = normaliseUrl(url);
  if (!target) return { ...EMPTY, url: '' };
  let text = '';
  try {
    const html = await fetchText(target, { headers: { 'User-Agent': 'Mozilla/5.0 (GreenShiftComms; +https://greenshiftenergy.co.uk)' } }, 12000);
    text = htmlToText(html);
  } catch (e) {
    return { ...EMPTY, url: target, provider: 'error', error: `Couldn’t fetch the site: ${(e as Error).message}` };
  }
  if (!text) return { ...EMPTY, url: target, provider: 'error', error: 'No readable content found on that page.' };
  const out = await extractLoaFields(text, current, true);
  return { ...out, url: target };
}
