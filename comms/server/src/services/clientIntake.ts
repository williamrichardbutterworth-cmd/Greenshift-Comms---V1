import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { clientIntakePrompt, type ClientMeter } from './prompts';
import { fetchWebsiteText } from './loaIntel';

// Comprehensive new-client intake: scrape the website + read the transcript +
// uploaded bills (text and/or images), and extract ONE structured profile.
// Never throws — degrades to provider:'none'/'error' with empty data.

const MILESTONE_KEYS = ['billReceived', 'loaSent', 'loaReturned', 'quotesGathered', 'proposalSent', 'signed'];
const FUELS = ['gas', 'electric', 'both'];

export interface ClientIntake {
  companyName: string; registeredNo: string; businessAddress: string; postcode: string; industry: string;
  contactName: string; position: string; email: string; telephone: string;
  fuel: '' | 'gas' | 'electric' | 'both';
  currentSupplier: string; contractEnd: string; consumption: string;
  meters: ClientMeter[];
  services: string[];
  companySummary: string;
  summary: string; points: string[]; angles: string[]; suggestedMilestones: string[];
  websiteUrl: string;
  provider: string; error?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, n) : []);

function coerceMeters(v: unknown): ClientMeter[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const type = str(o.type).toLowerCase() === 'gas' ? 'gas' : 'electric';
    const meter: ClientMeter = { type };
    for (const k of ['mpan', 'mprn', 'siteAddress', 'supplier', 'contractEnd', 'consumption'] as const) {
      const val = str(o[k]); if (val) (meter as unknown as Record<string, string>)[k] = val;
    }
    return meter;
  }).filter((m) => m.mpan || m.mprn || m.siteAddress || m.supplier || m.contractEnd || m.consumption);
}

const EMPTY: ClientIntake = {
  companyName: '', registeredNo: '', businessAddress: '', postcode: '', industry: '',
  contactName: '', position: '', email: '', telephone: '',
  fuel: '', currentSupplier: '', contractEnd: '', consumption: '',
  meters: [], services: [], companySummary: '', summary: '', points: [], angles: [], suggestedMilestones: [],
  websiteUrl: '', provider: 'none',
};

export async function clientIntake(input: {
  website?: string;
  transcript?: string;
  fileTexts?: string[];
  images?: { base64: string; mime?: string }[];
}): Promise<ClientIntake> {
  // Scrape the website server-side (best-effort).
  let websiteText = '';
  let websiteUrl = '';
  if (input.website?.trim()) {
    const w = await fetchWebsiteText(input.website);
    websiteText = w.text; websiteUrl = w.url;
  }
  const hasAny = websiteText || input.transcript?.trim() || (input.fileTexts ?? []).some((t) => t?.trim()) || (input.images ?? []).length;
  if (!hasAny) return { ...EMPTY, websiteUrl };
  if (!aiConfigured()) return { ...EMPTY, websiteUrl, error: 'Automatic extraction isn’t configured.' };

  try {
    const ai = getAI();
    const { system, prompt } = clientIntakePrompt({
      website: websiteText || undefined,
      transcript: input.transcript,
      fileTexts: input.fileTexts,
      hasImages: (input.images ?? []).length > 0,
    });
    const images = (input.images ?? []).map((im) => ({ base64: im.base64, mime: im.mime ?? 'image/png' }));
    const raw = await ai.generateJSON<Record<string, unknown>>({ system, prompt, maxTokens: 2200, images: images.length ? images : undefined });
    const r = raw ?? {};
    const fuel = str(r.fuel).toLowerCase();
    return {
      companyName: str(r.companyName), registeredNo: str(r.registeredNo), businessAddress: str(r.businessAddress),
      postcode: str(r.postcode), industry: str(r.industry),
      contactName: str(r.contactName), position: str(r.position), email: str(r.email), telephone: str(r.telephone),
      fuel: (FUELS.includes(fuel) ? fuel : '') as ClientIntake['fuel'],
      currentSupplier: str(r.currentSupplier), contractEnd: str(r.contractEnd), consumption: str(r.consumption),
      meters: coerceMeters(r.meters),
      services: strList(r.services, 8),
      companySummary: str(r.companySummary).slice(0, 800),
      summary: str(r.summary), points: strList(r.points, 12), angles: strList(r.angles, 6),
      suggestedMilestones: strList(r.suggestedMilestones, 6).filter((m) => MILESTONE_KEYS.includes(m)),
      websiteUrl,
      provider: ai.name,
    };
  } catch (e) {
    return { ...EMPTY, websiteUrl, provider: 'error', error: (e as Error).message };
  }
}
