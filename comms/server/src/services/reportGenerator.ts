import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { getMarketSnapshot } from '../providers/marketData';
import { reportNarrativePrompt, type ReportInputs } from './prompts';
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
