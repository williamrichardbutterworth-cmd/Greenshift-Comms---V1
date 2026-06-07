import { cache } from '../lib/cache';
import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { getMarketSnapshot } from '../providers/marketData';
import { getNews } from '../providers/news';
import { dailyReviewPrompt } from './prompts';

export interface DailyReview {
  configured: boolean;
  provider?: string;
  asOf: string;
  review: string;
  talkingPoints: { type: 'fact' | 'statement' | 'question'; text: string }[];
  geoHooks: { headline: string; angle: string }[];
  note?: string;
}

const CACHE_KEY = 'daily-review';
const TTL = 1000 * 60 * 60 * 6; // 6h — one generation shared by the whole team

export async function getDailyReview(force = false): Promise<DailyReview> {
  if (!force) {
    const cached = cache.get<DailyReview>(CACHE_KEY);
    if (cached) return cached;
  }

  const [snapshot, news] = await Promise.all([getMarketSnapshot(), getNews(12)]);

  if (!aiConfigured()) {
    return {
      configured: false,
      asOf: new Date().toISOString(),
      review:
        'AI is not configured yet. Add an ANTHROPIC_API_KEY (or set AI_PROVIDER=openai with an OPENAI_API_KEY) in server/.env, then refresh to generate today\'s brief automatically.',
      talkingPoints: [],
      geoHooks: news.slice(0, 3).map((n) => ({ headline: n.title, angle: 'Enable AI to auto-generate a call angle.' })),
      note: 'Set up an AI provider to unlock the daily brief and talking points.',
    };
  }

  const ai = getAI();
  const { system, prompt } = dailyReviewPrompt(snapshot, news);
  const data = await ai.generateJSON<Omit<DailyReview, 'configured' | 'asOf' | 'provider'>>({
    system,
    prompt,
    maxTokens: 1500,
    temperature: 0.5,
  });

  const result: DailyReview = {
    configured: true,
    provider: ai.name,
    asOf: new Date().toISOString(),
    review: data.review,
    talkingPoints: data.talkingPoints ?? [],
    geoHooks: data.geoHooks ?? [],
  };
  cache.set(CACHE_KEY, result, TTL);
  return result;
}
