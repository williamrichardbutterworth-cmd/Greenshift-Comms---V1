import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { reportFillPrompt, type NarrativeFact, type ReportInputs } from './prompts';
import { getClientProfile } from './clientProfilesStore';

// Draft the narrative tokens for a generated report, grounded in the client record
// and the already-computed figures. Never throws — degrades to provider:'none'/'error'.
export interface NarrativeResult { values: Record<string, string>; provider: string; error?: string }

const KEYS_BY_KIND: Record<string, string[]> = {
  'cost-comparison': ['summaryCurrent', 'summaryRecommended', 'recommendationTitle', 'recommendationRationale'],
  'procure-ahead': ['chartCaption', 'commentaryDrivers', 'commentaryOutlook', 'implication', 'stanceTag', 'stanceHeadline', 'stanceRationale', 'talkingPoint1', 'talkingPoint2', 'talkingPoint3', 'talkingPoint4'],
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function draftReportNarrative(input: {
  kind: string;
  clientProfileId?: string;
  facts: NarrativeFact[];
  values: Record<string, string>;
}): Promise<NarrativeResult> {
  if (!aiConfigured()) return { values: {}, provider: 'none', error: 'Automatic drafting isn’t configured.' };
  try {
    const profile = input.clientProfileId ? await getClientProfile(input.clientProfileId) : null;
    const inputs = (profile?.inputs ?? {}) as ReportInputs;
    const ai = getAI();
    const { system, prompt } = reportFillPrompt(input.kind, inputs, input.facts ?? [], input.values ?? {});
    const res = await ai.generateJSON<Record<string, unknown>>({ system, prompt, maxTokens: 1100 });
    const keys = KEYS_BY_KIND[input.kind] ?? KEYS_BY_KIND['cost-comparison'];
    const out: Record<string, string> = {};
    for (const k of keys) { const v = str(res?.[k]); if (v) out[k] = v; }
    return { values: out, provider: ai.name };
  } catch (e) {
    return { values: {}, provider: 'error', error: (e as Error).message };
  }
}
