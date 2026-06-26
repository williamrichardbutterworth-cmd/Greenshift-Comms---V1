import { aiConfigured } from '../config';
import { getAI } from '../providers/ai';
import { emailDraftPrompt, type EmailMsg, type ReportInputs } from './prompts';

// Draft the next email in an ongoing client conversation. Never throws — degrades
// to a provider:'none'/'error' shape like the other AI services.
export interface EmailDraft { subject: string; body: string; provider: string; error?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function draftEmail(
  inputs: ReportInputs,
  history: EmailMsg[],
  opts: { mode: 'reply' | 'follow-up'; instruction?: string; angles?: string[] },
): Promise<EmailDraft> {
  if (!aiConfigured()) return { subject: '', body: '', provider: 'none', error: 'Automatic drafting isn’t configured.' };
  try {
    const ai = getAI();
    const { system, prompt } = emailDraftPrompt(inputs, history, opts);
    const res = await ai.generateJSON<{ subject?: unknown; body?: unknown }>({ system, prompt, maxTokens: 1200 });
    return { subject: str(res?.subject), body: str(res?.body), provider: ai.name };
  } catch (e) {
    return { subject: '', body: '', provider: 'error', error: (e as Error).message };
  }
}
