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

// ── Generation map (GET /api/grid) ──
export type GridIndex = 'very low' | 'low' | 'moderate' | 'high' | 'very high' | null;
export interface GridRegion {
  id: number; name: string; dno: string;
  intensity: number | null; index: GridIndex; mix: FuelShare[];
}
export interface Interconnector {
  code: string; name: string; country: string;
  mw: number; dir: 'import' | 'export' | 'idle';
}
export interface GridSnapshot {
  asOf: string;
  national: { intensity: number | null; index: GridIndex; mix: FuelShare[] };
  regions: GridRegion[];
  interconnectors: Interconnector[];
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
  currentProduct?: string;
  currentUnitRate?: string;
  currentStanding?: string;
  contractEnd?: string;
  consumption?: string;
  agentNotes?: string;
  /** Which document template this project was created from (persisted on the project). */
  documentTypeId?: string;
  documentChannel?: 'document' | 'email';
  /** Report identity stamped from the template at creation → drives the export cover. */
  documentTypeName?: string;
  documentSubtitle?: string;
  reportKind?: string;
  /** The client this document belongs to (links a project back to its CRM record). */
  clientProfileId?: string;
}

// ── Document templates (user-definable) ──
export interface TemplateSection {
  kind: 'text' | 'embed';
  heading?: string;
  guidance?: string;
  ref?: string;
}
export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  channel: 'document' | 'email';
  icon?: string;
  reportKind?: string;
  subtitle?: string;
  guidance: string;
  sections: TemplateSection[];
  builtin: boolean;
  createdAt: string;
}
export interface NewTemplate {
  name?: string;
  description?: string;
  channel?: 'document' | 'email';
  icon?: string;
  reportKind?: string;
  subtitle?: string;
  guidance?: string;
  sections?: TemplateSection[];
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
export interface ReportMeta {
  asOf?: string;
  attributions?: string[];
  /** Report identity for the exported cover/letterhead (falls back to the market-report defaults). */
  reportTitle?: string;
  reportSubtitle?: string;
  reportKind?: string;
}

// ── KPI strip (compact "at a glance" headline numbers) ──
export interface KpiCard { label: string; value: string; unit?: string; delta?: number | null; tone?: 'up' | 'down' | 'flat' | 'accent'; }
export interface KpiStripData { cards: KpiCard[]; asOf?: string; note?: string; }

// ── Supplier / scenario comparison table (agent-filled) ──
export interface ComparisonRow { option: string; unitRate?: string; standingCharge?: string; term?: string; annualCost?: string; green?: boolean; recommended?: boolean; }
export interface ComparisonTableData { rows: ComparisonRow[]; caption?: string; }

// ── Recommendation box (styled verdict block; AI-written text) ──
export interface RecommendationBoxData { text: string; label?: string; }

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
export type ContextKind = 'clientInfo' | 'marketSnapshot' | 'dailyBrief' | 'news' | 'customChart' | 'note' | 'conversation';
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
export interface ReportProjectSummary { id: string; name: string; createdAt: string; updatedAt: string; templateId?: string; }
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
  templateId?: string;
  linkedConversations?: { when?: string; summary?: string; points?: string[]; angles?: string[] }[];
}
export interface AssembleResult { sections: SectionSpec[]; snapshot: MarketSnapshot; provider: string; note?: string; }

export type EditAction = 'concise' | 'expand' | 'addData' | 'rewrite' | 'regenerate' | 'analyseChart';

// ── Report engine: AI narrative drafting ──
export interface NarrativeFact { label: string; value: string }
export interface DraftNarrativePayload {
  kind: string;
  clientProfileId?: string;
  facts: NarrativeFact[];
  values: Record<string, string>;
}
export interface DraftNarrativeResult { values: Record<string, string>; provider: string; error?: string; }
export interface EditResult { text: string; provider: string; error?: string; }

// ── Client records (CRM) ──
export type ClientStage = 'new' | 'profiling' | 'loa' | 'data' | 'tender' | 'proposal' | 'won' | 'lost';
export type ActivityType =
  | 'note' | 'transcript' | 'email-sent' | 'email-received' | 'document' | 'file' | 'stage' | 'milestone' | 'recommendation';
export interface ClientActivity {
  id: string; at: string; type: ActivityType; title: string; detail?: string; meta?: Record<string, unknown>;
}
export interface ClientProfile {
  id: string; name: string; inputs: ReportInputs; createdAt: string;
  stage: ClientStage;
  tracker: Record<string, string | null>;
  activities: ClientActivity[];
  updatedAt: string;
}
export interface NewClientProfile {
  name?: string; inputs?: ReportInputs; stage?: ClientStage;
  tracker?: Record<string, string | null>; activities?: ClientActivity[];
}
export interface NewActivity { type: ActivityType; title: string; detail?: string; meta?: Record<string, unknown>; }

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

// ── CRM: source analysis + next-step recommendation ──
export type SourceKind = 'transcript' | 'bill' | 'email' | 'auto';
export interface SourceAnalysis {
  kind: string; profile: Partial<ReportInputs>; summary: string; points: string[];
  /** Client-specific conversational angles/hooks for the next call. */
  angles: string[];
  suggestedMilestones: string[]; provider: string; error?: string;
}
export interface NextStep { action: string; rationale: string; templateId: string; provider: string; error?: string; }
export interface RecommendClientPayload {
  inputs: ReportInputs; stage: string; doneMilestones: string[]; recentActivity: string[];
}

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

// ── Forward curve (procurement timing): UK power baseload + NBP gas season tables
// captured daily from the morning market report. ──
export type Commodity = 'power' | 'gas';
export interface CurveLeg {
  label: string;
  latest: number | null;
  prev: number | null;
  current: number | null;
}
export interface CommodityCurve {
  commodity: Commodity;
  unit: string;
  legs: CurveLeg[];
}
export interface ForwardCurveSnapshot {
  id: string;
  asOfDate: string;
  source: string;
  note?: string;
  curves: CommodityCurve[];
  createdAt: string;
}
export interface NewForwardCurve {
  asOfDate?: string;
  source?: string;
  note?: string;
  curves: CommodityCurve[];
}
export interface ForwardCurveExtract {
  asOfDate: string;
  source: string;
  curves: CommodityCurve[];
  provider: string;
  error?: string;
}
export interface ForwardTrend {
  commodity: Commodity;
  unit: string;
  points: { t: string; v: number }[];
}

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

// ── Letter of Authority + Companies House ──
export interface LoaExtractResult {
  fields: Record<string, string>;
  fuel: 'gas' | 'electric' | 'both' | '';
  services: string[];
  companySummary: string;
  provider: string;
  error?: string;
  url?: string;
}
export interface ChCompanySummary {
  companyNumber: string; title: string; status: string; type: string; addressSnippet: string; incorporatedOn: string;
}
export interface ChCompanyProfile extends ChCompanySummary { registeredAddress: string; postcode: string; sicCodes: string[]; }
export interface ChSearchResult { items: ChCompanySummary[]; provider: string; error?: string; }
export interface ChCompanyResult { company: ChCompanyProfile | null; provider: string; error?: string; }

// ── Comprehensive client intake (website + transcript + bills → profile) ──
export interface ClientMeter { type: 'electric' | 'gas'; mpan?: string; mprn?: string; siteAddress?: string; supplier?: string; contractEnd?: string; consumption?: string; }
export interface ClientIntakeResult {
  companyName: string; registeredNo: string; businessAddress: string; postcode: string; industry: string;
  contactName: string; position: string; email: string; telephone: string;
  fuel: '' | 'gas' | 'electric' | 'both';
  currentSupplier: string; contractEnd: string; consumption: string;
  meters: ClientMeter[]; services: string[]; companySummary: string;
  summary: string; points: string[]; angles: string[]; suggestedMilestones: string[];
  websiteUrl: string; provider: string; error?: string;
}
export interface ClientIntakePayload { website?: string; transcript?: string; fileTexts?: string[]; images?: { base64: string; mime?: string }[]; }

// ── Bill analysis (the swarm) ──
export type BillConfidence = 'high' | 'medium' | 'low';
export interface BillField { key: string; value: string; source: string; confidence: BillConfidence; }
export interface BillAnalysisResult { fields: BillField[]; provider: string; error?: string; }

// ── Email dialogue ──
export interface EmailMsg { direction: 'in' | 'out'; subject?: string; body: string; at?: string; }
export interface EmailDraft { subject: string; body: string; provider: string; error?: string; }
export interface EmailDraftPayload { inputs: ReportInputs; history: EmailMsg[]; mode: 'reply' | 'follow-up'; instruction?: string; angles?: string[]; }

export const api = {
  market: () => j<MarketSnapshot>('/api/market'),
  grid: () => j<GridSnapshot>('/api/grid'),
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
    fromUrl: (url: string) => j<SavedArticle>('/api/news/articles/from-url', postJson({ url })),
    remove: (id: string) => j<{ ok: boolean }>(`/api/news/articles/${id}`, { method: 'DELETE' }),
  },
  headlines: {
    list: () => j<Headline[]>('/api/news/headlines'),
    add: (input: ArticleInput & { priority?: number }) => j<Headline>('/api/news/headlines', postJson(input)),
    remove: (id: string) => j<{ ok: boolean }>(`/api/news/headlines/${id}`, { method: 'DELETE' }),
  },
  // Report engine: AI-draft the narrative tokens (grounded in the client + figures).
  reports: {
    draftNarrative: (input: DraftNarrativePayload) =>
      j<DraftNarrativeResult>('/api/report/narrative', postJson(input)),
  },

  // Saved, versioned report projects (now hold report-engine state on `inputs`).
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

  // Client records (CRM).
  profiles: {
    list: () => j<ClientProfile[]>('/api/client-profiles'),
    get: (id: string) => j<ClientProfile>(`/api/client-profiles/${id}`),
    create: (input: NewClientProfile) => j<ClientProfile>('/api/client-profiles', postJson(input)),
    update: (id: string, input: NewClientProfile) =>
      j<ClientProfile>(`/api/client-profiles/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    addActivity: (id: string, activity: NewActivity) =>
      j<ClientProfile>(`/api/client-profiles/${id}/activities`, postJson(activity)),
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

  // Forward-curve (procurement-timing) snapshots from the morning market report.
  forwardCurve: {
    latest: () => j<ForwardCurveSnapshot | null>('/api/forward-curve/latest'),
    list: () => j<ForwardCurveSnapshot[]>('/api/forward-curve'),
    trend: (commodity: Commodity) => j<ForwardTrend>(`/api/forward-curve/trend?commodity=${commodity}`),
    extract: (input: { text?: string; image?: { base64: string; mime: string } }) =>
      j<ForwardCurveExtract>('/api/forward-curve/extract', postJson(input)),
    save: (input: NewForwardCurve) => j<ForwardCurveSnapshot>('/api/forward-curve', postJson(input)),
    remove: (id: string) => j<{ ok: boolean }>(`/api/forward-curve/${id}`, { method: 'DELETE' }),
  },

  // Letter of Authority — Companies House lookup, website scrape, field extraction.
  loa: {
    chStatus: () => j<{ configured: boolean }>('/api/companies-house/status'),
    chSearch: (q: string) => j<ChSearchResult>(`/api/companies-house/search?q=${encodeURIComponent(q)}`),
    chCompany: (number: string) => j<ChCompanyResult>(`/api/companies-house/company/${encodeURIComponent(number)}`),
    scrape: (url: string, current?: Record<string, string>) => j<LoaExtractResult>('/api/loa/scrape', postJson({ url, current })),
    extract: (text: string, current?: Record<string, string>) => j<LoaExtractResult>('/api/loa/extract', postJson({ text, current })),
  },

  // Email dialogue — draft the next email/response in a client thread.
  email: {
    draft: (payload: EmailDraftPayload) => j<EmailDraft>('/api/email/draft', postJson(payload)),
  },

  // Comprehensive new-client intake (website + transcript + bills → one profile).
  client: {
    intake: (payload: ClientIntakePayload) => j<ClientIntakeResult>('/api/client/intake', postJson(payload)),
  },

  // Bill analysis swarm — extract supplier/meter/rates/contract with source provenance.
  bill: {
    analyze: (input: { text?: string; image?: { base64: string; mime?: string } }) =>
      j<BillAnalysisResult>('/api/bill/analyze', postJson(input)),
  },

  // Mine a pasted call transcript for client details.
  extractTranscript: (transcript: string) => j<TranscriptExtract>('/api/report/transcript-extract', postJson({ transcript })),
  // CRM intake + next-step recommendation.
  analyzeSource: (text: string, kind: SourceKind = 'auto', inputs?: ReportInputs) =>
    j<SourceAnalysis>('/api/report/analyze', postJson({ text, kind, inputs })),
  recommendNextStep: (client: RecommendClientPayload) =>
    j<NextStep>('/api/report/recommend', postJson({ client })),
  ideas: () => j<Idea[]>('/api/ideas'),
  ideasMeta: () => j<IdeasMeta>('/api/ideas/meta'),
  addIdea: (input: NewIdea) => j<Idea>('/api/ideas', postJson(input)),
  voteIdea: (id: string) => j<Idea>(`/api/ideas/${id}/vote`, { method: 'POST' }),
  setIdeaStatus: (id: string, status: IdeaStatus) =>
    j<Idea>(`/api/ideas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }),
  deleteIdea: (id: string) => j<{ ok: boolean }>(`/api/ideas/${id}`, { method: 'DELETE' }),
  ideasSummary: () => j<IdeasSummary>('/api/ideas/summary', { method: 'POST' }),
};
