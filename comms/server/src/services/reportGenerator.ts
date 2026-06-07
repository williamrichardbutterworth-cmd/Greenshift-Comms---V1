import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { getMarketSnapshot } from '../providers/marketData';
import {
  reportNarrativePrompt, reportAssemblePrompt, reportEditPrompt,
  type ReportInputs, type AssembleContext, type EditAction,
} from './prompts';
import type { NewsItem } from '../providers/news/types';
import type { MarketSnapshot } from '../providers/marketData/types';

export type { ReportInputs } from './prompts';

export interface ReportNarrative {
  executiveSummary: string;
  marketContext: string;
  outlook: string;
  recommendation: string;
}

/**
 * AI drafts the four narrative sections from the agent's inputs + selected
 * evidence. The frontend turns these into editable blocks and renders the
 * final PDF/Word in the browser (no server-side Puppeteer).
 */
export async function draftReport(
  inputs: ReportInputs,
  selectedNews: NewsItem[] = [],
): Promise<{ narrative: ReportNarrative; snapshot: MarketSnapshot; provider: string }> {
  const snapshot = await getMarketSnapshot();
  if (!aiConfigured()) {
    const placeholder: ReportNarrative = {
      executiveSummary: '[Set up an AI provider to auto-draft this, or write it here.]',
      marketContext: '[Market context…]',
      outlook: '[Outlook…]',
      recommendation: '[Recommendation…]',
    };
    return { narrative: placeholder, snapshot, provider: 'none' };
  }
  const ai = getAI();
  const { system, prompt } = reportNarrativePrompt(inputs, snapshot, selectedNews);
  const narrative = await ai.generateJSON<ReportNarrative>({ system, prompt, maxTokens: 1800, temperature: 0.5 });
  return { narrative, snapshot, provider: ai.name };
}

// ── Section-based assembly: the AI returns an ordered list of section specs the
// frontend deterministically turns into the editable document. Always resolves
// (never throws) — AI/billing/rate-limit failures degrade to an editable
// placeholder skeleton so a report can still be built by hand.

export interface SectionSpec {
  kind: 'text' | 'embed';
  heading?: string;
  body?: string;
  ref?: string;
}

const VALID_REF = (ref: string, ctx: AssembleContext): boolean =>
  ref === 'marketSnapshot' ||
  ref === 'selectedNews' ||
  /^chart:(brent|gas|power):(3m|6m|12m)$/.test(ref) ||
  (ctx.customCharts ?? []).some((c) => ref === `customChart:${c.id}`);

function sanitiseSections(raw: unknown, ctx: AssembleContext): SectionSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: SectionSpec[] = [];
  for (const s of raw.slice(0, 14)) {
    const sec = s as Record<string, unknown>;
    const heading = typeof sec.heading === 'string' ? sec.heading.slice(0, 160) : undefined;
    if (sec.kind === 'embed') {
      const ref = typeof sec.ref === 'string' ? sec.ref : '';
      if (VALID_REF(ref, ctx)) out.push({ kind: 'embed', heading, ref });
    } else {
      const body = typeof sec.body === 'string' ? sec.body : '';
      if (body.trim() || heading) out.push({ kind: 'text', heading, body });
    }
  }
  return out;
}

function placeholderSections(ctx: AssembleContext): SectionSpec[] {
  return [
    { kind: 'text', heading: 'Executive summary', body: '[Write the executive summary here, or use “Assemble with AI” once a working AI key is configured.]' },
    { kind: 'text', heading: 'Market context', body: '[Summarise where gas & power are and what is driving them.]' },
    ...(ctx.includeSnapshot ? [{ kind: 'embed' as const, heading: 'Market data', ref: 'marketSnapshot' }] : []),
    { kind: 'text', heading: 'Outlook', body: '[Balanced outlook — no over-promising.]' },
    { kind: 'text', heading: 'Our recommendation', body: '[What Green Shift suggests and why, tailored to this client.]' },
    ...(ctx.selectedNews?.length ? [{ kind: 'embed' as const, heading: 'Supporting evidence', ref: 'selectedNews' }] : []),
  ];
}

export async function assembleReport(
  inputs: ReportInputs,
  ctx: AssembleContext,
): Promise<{ sections: SectionSpec[]; snapshot: MarketSnapshot; provider: string; note?: string }> {
  const snapshot = await getMarketSnapshot();
  if (!aiConfigured()) return { sections: placeholderSections(ctx), snapshot, provider: 'none' };
  try {
    const ai = getAI();
    const { system, prompt } = reportAssemblePrompt(inputs, snapshot, ctx);
    const res = await ai.generateJSON<{ sections: unknown }>({ system, prompt, maxTokens: 2400 });
    const sections = sanitiseSections(res.sections, ctx);
    if (!sections.length) return { sections: placeholderSections(ctx), snapshot, provider: ai.name, note: 'AI returned no usable sections.' };
    return { sections, snapshot, provider: ai.name };
  } catch (e) {
    // Billing / rate-limit / network: keep the report usable rather than 500.
    return { sections: placeholderSections(ctx), snapshot, provider: 'error', note: (e as Error).message };
  }
}

// Inline edit of a passage (concise / expand / add data / rewrite / regenerate)
// or a one-line chart caption. Never throws; returns the original text on failure.
export async function editText(
  action: EditAction,
  text: string,
  opts: { instruction?: string } = {},
): Promise<{ text: string; provider: string; error?: string }> {
  if (!text.trim()) return { text, provider: 'none' };
  if (!aiConfigured()) return { text, provider: 'none', error: 'AI not configured.' };
  try {
    const ai = getAI();
    const snapshot = action === 'addData' ? await getMarketSnapshot() : undefined;
    const { system, prompt } = reportEditPrompt(action, text, { snapshot, instruction: opts.instruction });
    const out = await ai.generateText({ system, prompt, maxTokens: 900 });
    return { text: out.trim() || text, provider: ai.name };
  } catch (e) {
    return { text, provider: 'error', error: (e as Error).message };
  }
}
