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
  topic?: string;
  angle?: string;
}

// ── News curation (§8A): feeds, saved-article library, headlines ──
export interface NewsFeedSource { id: string; name: string; url: string; enabled: boolean; createdAt: string; }
export interface SavedArticle {
  id: string; title: string; source: string; url: string; summary: string;
  topic: string; note: string; publishedAt: string | null; createdAt: string;
}
export interface Headline {
  id: string; title: string; source: string; url: string; summary: string;
  topic: string; priority: number; publishedAt: string | null; createdAt: string;
}
export interface ArticleInput {
  title: string; source?: string; url?: string; summary?: string;
  topic?: string; note?: string; publishedAt?: string | null;
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

// ── Embedded report data shapes (used as TipTap node attrs) ──
export interface MetricRow { label: string; value: number | string | null; unit: string; changePct?: number | null; }
export interface ChartData { series: SeriesKey; label: string; unit: string; range: RangeKey; points: SeriesPoint[]; sourceName?: string; }
export interface NewsRef { source: string; title: string; url?: string; }
export interface ReportMeta { asOf?: string; attributions?: string[]; }

// ── Report document (TipTap / ProseMirror JSON) ──
// Loose structural types so the exporter & doc-builder can walk the document
// without depending on TipTap itself.
export interface DocMark { type: string; attrs?: Record<string, unknown>; }
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}
export interface ReportDoc { type: 'doc'; content?: DocNode[]; }
export const EMPTY_DOC: ReportDoc = { type: 'doc', content: [] };

// ── Custom chart (in-app data → chart builder) ──
export interface CustomChartPoint { label: string; value: number; }
export interface CustomChartData {
  title: string;
  unit: string;
  kind: 'line' | 'bar';
  points: CustomChartPoint[];
  caption?: string;
  sourceName?: string;
}

// ── AI context tray ──
export type ContextKind = 'clientInfo' | 'marketSnapshot' | 'dailyBrief' | 'news' | 'customChart' | 'note';
export interface ContextItem {
  id: string;
  kind: ContextKind;
  label: string;
  news?: NewsRef[];
  chart?: CustomChartData;
  note?: string;
  brief?: string;
}

// ── Saved, versioned report projects ──
export interface ReportProjectSummary { id: string; name: string; createdAt: string; updatedAt: string; }
export interface ReportVersion { at: string; label: string; doc: ReportDoc; inputs: ReportInputs; }
export interface ReportProject extends ReportProjectSummary {
  inputs: ReportInputs;
  doc: ReportDoc;
  context: ContextItem[];
  versions: ReportVersion[];
}
export interface NewProject { name?: string; inputs?: ReportInputs; doc?: ReportDoc; context?: ContextItem[]; }
export interface ProjectPatch {
  name?: string; inputs?: ReportInputs; doc?: ReportDoc; context?: ContextItem[];
  saveVersion?: boolean; versionLabel?: string;
}

// ── AI assembly (section specs) + inline edits ──
export interface SectionText { kind: 'text'; heading?: string; body: string; }
export interface SectionEmbed { kind: 'embed'; heading?: string; ref: string; }
export type SectionSpec = SectionText | SectionEmbed;

export interface AssembleContextPayload {
  selectedNews?: { source: string; title: string; summary?: string }[];
  includeSnapshot?: boolean;
  dailyBrief?: string | null;
  extraNotes?: string;
  customCharts?: { id: string; title: string; points: CustomChartPoint[] }[];
}
export interface AssembleResult { sections: SectionSpec[]; snapshot: MarketSnapshot; provider: string; note?: string; }

export type EditAction = 'concise' | 'expand' | 'addData' | 'rewrite' | 'regenerate' | 'analyseChart';
export interface EditResult { text: string; provider: string; error?: string; }

// ── Reusable client profiles ──
export interface ClientProfile { id: string; name: string; inputs: ReportInputs; createdAt: string; }
export interface NewClientProfile { name?: string; inputs?: ReportInputs; }

// ── Uploaded files / media ──
export interface ClientFile {
  id: string; clientProfileId: string | null; projectId: string | null;
  name: string; mime: string; size: number; storagePath: string; extractedText: string; createdAt: string;
}
export interface NewFileUpload {
  name: string; mime?: string; projectId?: string | null; clientProfileId?: string | null; dataBase64: string;
}

// ── Call-transcript extraction ──
export interface TranscriptExtract { profile: Partial<ReportInputs>; points: string[]; provider: string; error?: string; }

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
  newsTopics: () => j<string[]>('/api/news/topics'),
  newsFeeds: {
    list: () => j<NewsFeedSource[]>('/api/news/feeds'),
    add: (input: { name?: string; url: string }) => j<NewsFeedSource>('/api/news/feeds', postJson(input)),
    setEnabled: (id: string, enabled: boolean) =>
      j<NewsFeedSource>(`/api/news/feeds/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
    remove: (id: string) => j<{ ok: boolean }>(`/api/news/feeds/${id}`, { method: 'DELETE' }),
  },
  savedArticles: {
    list: () => j<SavedArticle[]>('/api/news/articles'),
    save: (input: ArticleInput) => j<SavedArticle>('/api/news/articles', postJson(input)),
    remove: (id: string) => j<{ ok: boolean }>(`/api/news/articles/${id}`, { method: 'DELETE' }),
  },
  headlines: {
    list: () => j<Headline[]>('/api/news/headlines'),
    add: (input: ArticleInput & { priority?: number }) => j<Headline>('/api/news/headlines', postJson(input)),
    remove: (id: string) => j<{ ok: boolean }>(`/api/news/headlines/${id}`, { method: 'DELETE' }),
  },
  draftReport: (inputs: ReportInputs, selectedNews: NewsItem[]) =>
    j<{ narrative: ReportNarrative; snapshot: MarketSnapshot; provider: string }>(
      '/api/report/draft',
      postJson({ inputs, selectedNews }),
    ),
  assembleReport: (inputs: ReportInputs, context: AssembleContextPayload) =>
    j<AssembleResult>('/api/report/assemble', postJson({ inputs, context })),
  editReport: (action: EditAction, text: string, instruction?: string) =>
    j<EditResult>('/api/report/edit', postJson({ action, text, instruction })),

  // Saved, versioned report projects (§8B).
  projects: {
    list: () => j<ReportProjectSummary[]>('/api/report/projects'),
    get: (id: string) => j<ReportProject>(`/api/report/projects/${id}`),
    create: (input: NewProject) => j<ReportProject>('/api/report/projects', postJson(input)),
    update: (id: string, patch: ProjectPatch) =>
      j<ReportProject>(`/api/report/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    remove: (id: string) => j<{ ok: boolean }>(`/api/report/projects/${id}`, { method: 'DELETE' }),
  },

  // Reusable client profiles.
  profiles: {
    list: () => j<ClientProfile[]>('/api/client-profiles'),
    get: (id: string) => j<ClientProfile>(`/api/client-profiles/${id}`),
    create: (input: NewClientProfile) => j<ClientProfile>('/api/client-profiles', postJson(input)),
    update: (id: string, input: NewClientProfile) =>
      j<ClientProfile>(`/api/client-profiles/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    remove: (id: string) => j<{ ok: boolean }>(`/api/client-profiles/${id}`, { method: 'DELETE' }),
  },

  // Uploaded report files / media.
  files: {
    list: (params: { projectId?: string; clientProfileId?: string }) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
      return j<ClientFile[]>(`/api/report/files${qs ? `?${qs}` : ''}`);
    },
    upload: (input: NewFileUpload) => j<ClientFile>('/api/report/files', postJson(input)),
    remove: (id: string) => j<{ ok: boolean }>(`/api/report/files/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: string) => `/api/report/files/${id}/download`,
  },

  // Mine a pasted call transcript for client details.
  extractTranscript: (transcript: string) => j<TranscriptExtract>('/api/report/transcript-extract', postJson({ transcript })),
  ideas: () => j<Idea[]>('/api/ideas'),
  ideasMeta: () => j<IdeasMeta>('/api/ideas/meta'),
  addIdea: (input: NewIdea) => j<Idea>('/api/ideas', postJson(input)),
  voteIdea: (id: string) => j<Idea>(`/api/ideas/${id}/vote`, { method: 'POST' }),
  setIdeaStatus: (id: string, status: IdeaStatus) =>
    j<Idea>(`/api/ideas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  deleteIdea: (id: string) => j<{ ok: boolean }>(`/api/ideas/${id}`, { method: 'DELETE' }),
  ideasSummary: () => j<IdeasSummary>('/api/ideas/summary', { method: 'POST' }),
};
