import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import {
  transcriptExtractPrompt, sourceAnalysisPrompt, nextStepPrompt, forwardCurveExtractPrompt,
  type ReportInputs, type SourceKind, type RecommendClient, type RecommendTemplate, type ClientMeter,
} from './prompts';
import { coerceCurves, type CommodityCurve } from './forwardCurveStore';
import { coerceMeters } from './clientIntake';

export type { ReportInputs } from './prompts';

// Every client-record field a call/email/bill can legitimately fill — keys the
// extractors return outside this list are discarded (mirrors CLIENT_FIELD_GROUPS
// in web/src/lib/clientProfile.ts — keep in sync).
const PROFILE_KEYS = [
  'companyName', 'clientName', 'position', 'email', 'telephone', 'contact',
  'registeredNo', 'businessAddress', 'postcode', 'industry',
  'currentSupplier', 'currentProduct', 'currentUnitRate', 'currentStanding',
  'contractEnd', 'consumption', 'sites',
];

export async function extractTranscript(
  transcript: string,
): Promise<{ profile: Record<string, string>; points: string[]; provider: string; error?: string }> {
  if (!transcript.trim()) return { profile: {}, points: [], provider: 'none' };
  if (!aiConfigured()) return { profile: {}, points: [], provider: 'none', error: 'Automatic extraction isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = transcriptExtractPrompt(transcript);
    const res = await ai.generateJSON<{ profile?: Record<string, unknown>; points?: unknown }>({ system, prompt, maxTokens: 1200 });
    const profile: Record<string, string> = {};
    for (const k of PROFILE_KEYS) {
      const v = res.profile?.[k];
      if (typeof v === 'string' && v.trim()) profile[k] = v.trim().slice(0, 300);
    }
    const points = Array.isArray(res.points)
      ? res.points.filter((p) => typeof p === 'string' && p.trim()).map((p) => String(p).slice(0, 400)).slice(0, 8)
      : [];
    return { profile, points, provider: ai.name };
  } catch (e) {
    return { profile: {}, points: [], provider: 'error', error: (e as Error).message };
  }
}

// ── CRM: analyse a pasted/uploaded source for client intake. Never throws. ──
const MILESTONE_KEYS = ['billReceived', 'loaSent', 'loaReturned', 'quotesGathered', 'proposalSent', 'signed'];

/** A raw, ungrounded commitment as the model emitted it — calendarScan.groundEvents
 *  applies the provenance/date gates before anything reaches the calendar store. */
export interface RawCommitment {
  kind?: string; title?: string; dueISO?: string; dueText?: string;
  allDay?: boolean; source?: string; nature?: string; confidence?: string;
}
const coerceCommitments = (raw: unknown): RawCommitment[] =>
  Array.isArray(raw) ? raw.filter((e): e is RawCommitment => !!e && typeof e === 'object').slice(0, 12) : [];

export interface SourceAnalysis {
  kind: string;
  profile: Record<string, string>;
  /** Supply points mentioned in the source (merged by MPAN/MPRN downstream). */
  meters: ClientMeter[];
  /** Raw commitment candidates (only when requested) — must be grounded before use. */
  events: RawCommitment[];
  summary: string;
  points: string[];
  /** Client-specific conversational angles/hooks for the next call. */
  angles: string[];
  /** Warm, personal rapport-building questions tailored to the business. */
  rapport: string[];
  suggestedMilestones: string[];
  provider: string;
  error?: string;
}

export async function analyzeSource(
  text: string, kind: SourceKind, currentInputs?: ReportInputs,
  opts?: { loggedAt?: string; withEvents?: boolean },
): Promise<SourceAnalysis> {
  const empty: SourceAnalysis = { kind, profile: {}, meters: [], events: [], summary: '', points: [], angles: [], rapport: [], suggestedMilestones: [], provider: 'none' };
  if (!text.trim()) return empty;
  if (!aiConfigured()) return { ...empty, error: 'Automatic analysis isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = sourceAnalysisPrompt(text, kind, currentInputs, opts);
    const res = await ai.generateJSON<{ kind?: string; profile?: Record<string, unknown>; meters?: unknown; events?: unknown; summary?: unknown; points?: unknown; angles?: unknown; rapport?: unknown; suggestedMilestones?: unknown }>(
      // Headroom matters: a truncated JSON loses the WHOLE extraction, so budget
      // for the worst realistic case (full profile + 12 meters + 10 quoted events).
      { system, prompt, maxTokens: opts?.withEvents ? 4000 : 1800 },
    );
    const profile: Record<string, string> = {};
    for (const k of PROFILE_KEYS) {
      const v = res.profile?.[k];
      if (typeof v === 'string' && v.trim()) profile[k] = v.trim().slice(0, 300);
    }
    const strList = (raw: unknown, cap: number) => Array.isArray(raw)
      ? raw.filter((p) => typeof p === 'string' && p.trim()).map((p) => String(p).slice(0, 400)).slice(0, cap) : [];
    const suggestedMilestones = Array.isArray(res.suggestedMilestones)
      ? [...new Set(res.suggestedMilestones.filter((m): m is string => typeof m === 'string' && MILESTONE_KEYS.includes(m)))] : [];
    return {
      kind: typeof res.kind === 'string' ? res.kind : (kind === 'auto' ? 'note' : kind),
      profile,
      meters: coerceMeters(res.meters),
      events: opts?.withEvents ? coerceCommitments(res.events) : [],
      summary: typeof res.summary === 'string' ? res.summary.slice(0, 400) : '',
      points: strList(res.points, 8), angles: strList(res.angles, 5), rapport: strList(res.rapport, 4), suggestedMilestones, provider: ai.name,
    };
  } catch (e) {
    return { ...empty, provider: 'error', error: (e as Error).message };
  }
}

// ── Forward curve: extract the power + gas season tables from a pasted/uploaded
// morning market report (text and/or screenshot image). Never throws. ──
export interface ForwardCurveExtract {
  asOfDate: string;
  source: string;
  curves: CommodityCurve[];
  provider: string;
  error?: string;
}

export async function extractForwardCurve(input: { text?: string; image?: { base64: string; mime: string } }): Promise<ForwardCurveExtract> {
  const empty: ForwardCurveExtract = { asOfDate: '', source: '', curves: [], provider: 'none' };
  if (!input.text?.trim() && !input.image) return empty;
  if (!aiConfigured()) return { ...empty, error: 'Automatic extraction isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = forwardCurveExtractPrompt(input.text);
    const res = await ai.generateJSON<{ asOfDate?: unknown; source?: unknown; curves?: unknown }>({
      system, prompt, maxTokens: 2200, images: input.image ? [input.image] : undefined,
    });
    const curves = coerceCurves(res.curves);
    if (!curves.length) return { ...empty, provider: ai.name, error: 'No forward-price tables were found in what you provided.' };
    const asOf = typeof res.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(res.asOfDate.trim()) ? res.asOfDate.trim() : '';
    return { asOfDate: asOf, source: typeof res.source === 'string' ? res.source.trim().slice(0, 120) : '', curves, provider: ai.name };
  } catch (e) {
    return { ...empty, provider: 'error', error: (e as Error).message };
  }
}

// ── CRM: recommend the next best action for a client. Never throws. ──
export interface NextStep { action: string; rationale: string; templateId: string; provider: string; error?: string }

export async function recommendNextStep(client: RecommendClient, templates: RecommendTemplate[]): Promise<NextStep> {
  if (!aiConfigured()) return { action: '', rationale: '', templateId: '', provider: 'none', error: 'Automatic recommendations aren’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = nextStepPrompt(client, templates);
    const res = await ai.generateJSON<{ action?: unknown; rationale?: unknown; templateId?: unknown }>({ system, prompt, maxTokens: 600 });
    const templateId = typeof res.templateId === 'string' && templates.some((t) => t.id === res.templateId) ? res.templateId : '';
    return {
      action: typeof res.action === 'string' ? res.action.slice(0, 240) : '',
      rationale: typeof res.rationale === 'string' ? res.rationale.slice(0, 600) : '',
      templateId, provider: ai.name,
    };
  } catch (e) {
    return { action: '', rationale: '', templateId: '', provider: 'error', error: (e as Error).message };
  }
}
