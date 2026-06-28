import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { billPassPrompt, BILL_PASSES, type BillPass } from './prompts';

// Bill analysis "swarm": the specialised extractors run in PARALLEL, each an expert
// on one part of the bill (identity / meter / rates / contract). Disjoint by key, so
// merging is trivial. Each field carries a verbatim source quote + confidence so the
// UI can show where it came from and the agent can double-check before approving.
// Never throws — degrades to provider:'none'/'error'; one failed pass doesn't sink the rest.

export type BillConfidence = 'high' | 'medium' | 'low';
export interface BillField { key: string; value: string; source: string; confidence: BillConfidence }
export interface BillAnalysisResult { fields: BillField[]; provider: string; error?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const conf = (v: unknown): BillConfidence => (['high', 'medium', 'low'].includes(String(v)) ? (String(v) as BillConfidence) : 'low');

export async function analyzeBill(input: { text?: string; image?: { base64: string; mime?: string } }): Promise<BillAnalysisResult> {
  if (!aiConfigured()) return { fields: [], provider: 'none', error: 'Automatic analysis isn’t configured.' };
  if (!input.text?.trim() && !input.image) return { fields: [], provider: 'none', error: 'Nothing to analyse — the bill had no readable text or image.' };

  const ai = getAI();
  const images = input.image ? [{ base64: input.image.base64, mime: input.image.mime ?? 'image/png' }] : undefined;

  const runPass = async (pass: BillPass): Promise<BillField[]> => {
    try {
      const { system, prompt } = billPassPrompt(pass, input.text, !!images);
      const raw = await ai.generateJSON<{ fields?: Record<string, unknown> }>({ system, prompt, maxTokens: 900, images });
      const f = (raw?.fields ?? {}) as Record<string, unknown>;
      const out: BillField[] = [];
      for (const k of pass.keys) {
        const o = (f[k] ?? {}) as Record<string, unknown>;
        const value = str(o.value);
        if (!value) continue;
        out.push({ key: k, value, source: str(o.source), confidence: conf(o.confidence) });
      }
      return out;
    } catch {
      return [];
    }
  };

  try {
    const results = await Promise.all(BILL_PASSES.map(runPass));
    const seen = new Map<string, BillField>();
    for (const fld of results.flat()) if (!seen.has(fld.key)) seen.set(fld.key, fld);
    return { fields: [...seen.values()], provider: ai.name };
  } catch (e) {
    return { fields: [], provider: 'error', error: (e as Error).message };
  }
}
