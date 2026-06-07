// Typed client for the Comms backend. Calls go through Vite's /api proxy.

export interface SeriesPoint { t: string; v: number; }
export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  changePct?: number | null;
  series?: SeriesPoint[];
  meaning?: string;
  sourceName: string;
}
export interface FuelShare { fuel: string; pct: number; }
export interface SourceRef { name: string; url: string; attribution?: string; }
export interface MarketSnapshot {
  asOf: string;
  metrics: Metric[];
  generationMix: FuelShare[];
  sources: SourceRef[];
}
export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary?: string;
  angle?: string;
}
export interface TalkingPoint { type: 'fact' | 'statement' | 'question' | string; text: string; }
export interface GeoHook { headline: string; angle: string; }
export interface DailyReview {
  configured: boolean;
  provider?: string;
  asOf: string;
  review: string;
  talkingPoints: TalkingPoint[];
  geoHooks: GeoHook[];
  note?: string;
}
export interface ReportInputs {
  clientName?: string;
  companyName?: string;
  contact?: string;
  sites?: string;
  currentSupplier?: string;
  contractEnd?: string;
  consumption?: string;
  agentNotes?: string;
}
export interface ReportNarrative {
  executiveSummary: string;
  marketContext: string;
  outlook: string;
  recommendation: string;
}

// ── Price charts ──
export type SeriesKey = 'brent' | 'gas' | 'power';
export type RangeKey = '3m' | '6m' | '12m';
export interface SeriesMeta { key: SeriesKey; label: string; unit: string; }
export interface PriceSeries {
  key: SeriesKey;
  label: string;
  unit: string;
  range: RangeKey;
  points: SeriesPoint[];
  sourceName: string;
  attribution?: string;
}

// ── Report blocks (the customisable report model) ──
export interface MetricRow { label: string; value: number | string | null; unit: string; changePct?: number | null; }
export interface ChartData { series: SeriesKey; label: string; unit: string; range: RangeKey; points: SeriesPoint[]; sourceName?: string; }
export interface NewsRef { source: string; title: string; url?: string; }
export type ReportBlock =
  | { id: string; type: 'text'; heading: string; body: string }
  | { id: string; type: 'metrics'; heading: string; rows: MetricRow[]; asOf?: string }
  | { id: string; type: 'chart'; heading: string; chart: ChartData }
  | { id: string; type: 'news'; heading: string; items: NewsRef[] };
export interface ReportMeta { asOf?: string; attributions?: string[]; }

// ── Admin ideas (feedback board) ──
export type IdeaStatus = 'new' | 'considering' | 'planned' | 'done';
export interface Idea {
  id: string;
  author: string;
  title: string;
  details: string;
  reasoning: string;
  category: string;
  status: IdeaStatus;
  votes: number;
  createdAt: string;
}
export interface NewIdea {
  author?: string;
  title: string;
  details?: string;
  reasoning?: string;
  category?: string;
}
export interface IdeasMeta { categories: string[]; statuses: IdeaStatus[]; }
export interface IdeasSummary { configured: boolean; provider?: string; summary: string; }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error((await r.text()) || `Request failed: ${r.status}`);
  return (await r.json()) as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  market: () => j<MarketSnapshot>('/api/market'),
  marketSeries: () => j<SeriesMeta[]>('/api/market/series'),
  marketHistory: (series: SeriesKey, range: RangeKey) =>
    j<PriceSeries>(`/api/market/history?series=${series}&range=${range}`),
  dailyReview: () => j<DailyReview>('/api/daily-review'),
  refreshReview: () => j<DailyReview>('/api/daily-review/refresh', { method: 'POST' }),
  news: (limit = 12) => j<NewsItem[]>(`/api/news?limit=${limit}`),
  draftReport: (inputs: ReportInputs, selectedNews: NewsItem[]) =>
    j<{ narrative: ReportNarrative; snapshot: MarketSnapshot; provider: string }>(
      '/api/report/draft',
      postJson({ inputs, selectedNews }),
    ),
  ideas: () => j<Idea[]>('/api/ideas'),
  ideasMeta: () => j<IdeasMeta>('/api/ideas/meta'),
  addIdea: (input: NewIdea) => j<Idea>('/api/ideas', postJson(input)),
  voteIdea: (id: string) => j<Idea>(`/api/ideas/${id}/vote`, { method: 'POST' }),
  setIdeaStatus: (id: string, status: IdeaStatus) =>
    j<Idea>(`/api/ideas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  deleteIdea: (id: string) => j<{ ok: boolean }>(`/api/ideas/${id}`, { method: 'DELETE' }),
  ideasSummary: () => j<IdeasSummary>('/api/ideas/summary', { method: 'POST' }),
};
