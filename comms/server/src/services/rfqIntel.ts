import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { rfqExtractPrompt, RFQ_FIELD_KEYS } from './prompts';
import { fetchWebsiteText } from './loaIntel';

// Harvest Greenshift Lead-Generation-Form (RFQ) answers from a call transcript / notes,
// or basic info from a company website. Same never-throw contract as the LOA extractor:
// degrade to provider:'error'/'none'; empty string === unknown.
export interface RfqExtract {
  fields: Record<string, string>;
  companySummary: string;
  provider: string;
  error?: string;
}

const EMPTY: RfqExtract = { fields: {}, companySummary: '', provider: 'none' };
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function coerce(raw: { fields?: Record<string, unknown>; companySummary?: unknown }, provider: string): RfqExtract {
  const fields: Record<string, string> = {};
  for (const k of RFQ_FIELD_KEYS) { const v = str(raw.fields?.[k]); if (v) fields[k] = v; }
  return { fields, companySummary: str(raw.companySummary).slice(0, 800), provider };
}

export async function extractRfqFields(text: string, current?: Record<string, string>, fromWebsite = false): Promise<RfqExtract> {
  if (!text.trim()) return EMPTY;
  if (!aiConfigured()) return { ...EMPTY, error: 'Automatic extraction isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = rfqExtractPrompt(text, current, fromWebsite);
    const raw = await ai.generateJSON<{ fields?: Record<string, unknown>; companySummary?: unknown }>({ system, prompt, maxTokens: 1800 });
    return coerce(raw ?? {}, ai.name);
  } catch (e) {
    return { ...EMPTY, provider: 'error', error: (e as Error).message };
  }
}

export async function scrapeRfqWebsite(url: string, current?: Record<string, string>): Promise<RfqExtract & { url: string }> {
  const { url: target, text, error } = await fetchWebsiteText(url);
  if (error) return { ...EMPTY, url: target, provider: 'error', error };
  if (!text) return { ...EMPTY, url: target, provider: 'error', error: 'No readable content found on that page.' };
  const out = await extractRfqFields(text, current, true);
  return { ...out, url: target };
}
