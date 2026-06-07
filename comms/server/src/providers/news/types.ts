export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string; // ISO
  summary?: string;
  /** Optional one-liner: how an agent could use this on a call (AI-filled). */
  angle?: string;
}

export interface NewsProvider {
  readonly name: string;
  getItems(limit: number): Promise<NewsItem[]>;
}
