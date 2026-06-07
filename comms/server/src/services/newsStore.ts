import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';
import { fetchText } from '../lib/http';
import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { RSS_FEEDS } from '../providers/news/feeds';
import { classifyTopic } from '../providers/news/classify';
import { articleSummaryPrompt } from './prompts';

// News curation (§8A): user-curatable feeds, a saved-article library and the
// persisted "Headlines" set. Same dual Supabase/file-fallback design as the
// other stores; file fallback reads/writes one JSON per entity in server/data.

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
async function fileLoad<T>(name: string): Promise<T[]> {
  try { const p = JSON.parse(await readFile(join(DATA_DIR, name), 'utf8')); return Array.isArray(p) ? p : []; } catch { return []; }
}
async function filePersist<T>(name: string, rows: T[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const f = join(DATA_DIR, name); const tmp = `${f}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, f);
}
const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim() : '').slice(0, max);

// ───────────────────────── Feeds ─────────────────────────
export interface NewsFeed { id: string; name: string; url: string; enabled: boolean; createdAt: string; }
type FeedRow = { id: string; name: string; url: string; enabled: boolean; created_at: string };
const toFeed = (r: FeedRow): NewsFeed => ({ id: r.id, name: r.name, url: r.url, enabled: r.enabled, createdAt: r.created_at });

// Seed the curated defaults the first time the list is read, so they show up
// (toggleable) in the manage-feeds panel.
async function seedFeeds(): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    const { data } = await sb.from('news_feeds').select('id').limit(1);
    if (!data?.length) await sb.from('news_feeds').insert(RSS_FEEDS.map((f) => ({ name: f.name, url: f.url, enabled: true })));
  } else {
    const rows = await fileLoad<NewsFeed>('news-feeds.json');
    if (!rows.length) {
      const now = new Date().toISOString();
      await filePersist('news-feeds.json', RSS_FEEDS.map((f) => ({ id: randomUUID(), name: f.name, url: f.url, enabled: true, createdAt: now })));
    }
  }
}

export async function listFeeds(): Promise<NewsFeed[]> {
  await seedFeeds();
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('news_feeds').select('*').order('created_at');
    if (error) throw new Error(error.message);
    return (data as FeedRow[]).map(toFeed);
  }
  return fileLoad<NewsFeed>('news-feeds.json');
}
export async function activeFeeds(): Promise<{ name: string; url: string }[]> {
  try {
    const feeds = (await listFeeds()).filter((f) => f.enabled).map((f) => ({ name: f.name, url: f.url }));
    return feeds.length ? feeds : RSS_FEEDS;
  } catch {
    return RSS_FEEDS; // never let curation break the live feed
  }
}
export async function addFeed(input: { name?: string; url?: string }): Promise<NewsFeed> {
  const url = str(input.url, 500);
  if (!/^https?:\/\//i.test(url)) throw new Error('A valid feed URL (https://…) is required.');
  let name = str(input.name, 120);
  if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { name = 'Feed'; } }
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('news_feeds').insert({ name, url, enabled: true }).select().single();
    if (error) throw new Error(error.message);
    return toFeed(data as FeedRow);
  }
  const feed: NewsFeed = { id: randomUUID(), name, url, enabled: true, createdAt: new Date().toISOString() };
  await filePersist('news-feeds.json', [...(await fileLoad<NewsFeed>('news-feeds.json')), feed]);
  return feed;
}
export async function setFeedEnabled(id: string, enabled: boolean): Promise<NewsFeed | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('news_feeds').update({ enabled }).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toFeed(data as FeedRow) : null;
  }
  const rows = await fileLoad<NewsFeed>('news-feeds.json');
  const f = rows.find((x) => x.id === id);
  if (!f) return null;
  f.enabled = enabled;
  await filePersist('news-feeds.json', rows);
  return f;
}
export async function removeFeed(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('news_feeds').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad<NewsFeed>('news-feeds.json');
  const next = rows.filter((x) => x.id !== id);
  if (next.length === rows.length) return false;
  await filePersist('news-feeds.json', next);
  return true;
}

// ───────────────────── Saved articles (library) ─────────────────────
export interface SavedArticle {
  id: string; title: string; source: string; url: string; summary: string;
  topic: string; note: string; publishedAt: string | null; createdAt: string;
}
export interface ArticleInput { title?: string; source?: string; url?: string; summary?: string; topic?: string; note?: string; publishedAt?: string | null; }
type ArtRow = { id: string; title: string; source: string; url: string; summary: string; topic: string; note: string; published_at: string | null; created_at: string };
const toArticle = (r: ArtRow): SavedArticle => ({ id: r.id, title: r.title, source: r.source, url: r.url, summary: r.summary, topic: r.topic, note: r.note, publishedAt: r.published_at, createdAt: r.created_at });
const articleFields = (i: ArticleInput) => {
  const title = str(i.title, 400);
  if (!title) throw new Error('An article title is required.');
  return { title, source: str(i.source, 120), url: str(i.url, 800), summary: str(i.summary, 1000), topic: str(i.topic, 40) || classifyTopic(title, i.summary ?? ''), note: str(i.note, 1000), published_at: i.publishedAt ?? null };
};

export async function listArticles(): Promise<SavedArticle[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('saved_articles').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as ArtRow[]).map(toArticle);
  }
  return (await fileLoad<SavedArticle>('saved-articles.json')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveArticle(input: ArticleInput): Promise<SavedArticle> {
  const fields = articleFields(input);
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('saved_articles').insert(fields).select().single();
    if (error) throw new Error(error.message);
    return toArticle(data as ArtRow);
  }
  const art: SavedArticle = { id: randomUUID(), createdAt: new Date().toISOString(), title: fields.title, source: fields.source, url: fields.url, summary: fields.summary, topic: fields.topic, note: fields.note, publishedAt: fields.published_at };
  await filePersist('saved-articles.json', [art, ...(await fileLoad<SavedArticle>('saved-articles.json'))]);
  return art;
}
export async function removeArticle(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('saved_articles').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad<SavedArticle>('saved-articles.json');
  const next = rows.filter((x) => x.id !== id);
  if (next.length === rows.length) return false;
  await filePersist('saved-articles.json', next);
  return true;
}

// Fetch a URL and scrape its Open Graph / meta tags into a saved article.
function decodeEntities(s = ''): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}
function metaTag(html: string, ...props: string[]): string | undefined {
  for (const p of props) {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i'));
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, 'i'));
    const v = decodeEntities(a?.[1] ?? b?.[1] ?? '');
    if (v) return v;
  }
  return undefined;
}

// Strip an HTML page down to its readable article text (best-effort).
function extractReadableText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const main = cleaned.match(/<article[\s\S]*?<\/article>/i)?.[0]
    ?? cleaned.match(/<main[\s\S]*?<\/main>/i)?.[0]
    ?? cleaned;
  return decodeEntities(main.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export async function addArticleFromUrl(url: string): Promise<SavedArticle> {
  const u = (url ?? '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('A valid article URL (https://…) is required.');
  let html: string;
  try {
    html = await fetchText(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Comms/1.0; +greenshift)' } }, 12000);
  } catch {
    throw new Error('Could not fetch that URL.');
  }
  let host = 'Link';
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
  const title = metaTag(html, 'og:title', 'twitter:title') ?? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') ?? '';
  const ogDesc = metaTag(html, 'og:description', 'twitter:description', 'description') ?? '';

  // Prefer an AI summary of the article body; fall back to the meta description / first text.
  let summary = ogDesc;
  const body = extractReadableText(html);
  if (aiConfigured() && body.length > 200) {
    try {
      const ai = getAI();
      const { system, prompt } = articleSummaryPrompt(title || u, body);
      const s = (await ai.generateText({ system, prompt, maxTokens: 220 })).trim();
      if (s) summary = s;
    } catch { /* keep the meta description */ }
  }
  if (!summary) summary = body.slice(0, 280);

  return saveArticle({
    title: title || u,
    summary,
    source: metaTag(html, 'og:site_name') ?? host,
    url: u,
    publishedAt: metaTag(html, 'article:published_time') ?? null,
  });
}

// ───────────────────────── Headlines ─────────────────────────
export interface Headline {
  id: string; title: string; source: string; url: string; summary: string;
  topic: string; priority: number; publishedAt: string | null; createdAt: string;
}
type HeadRow = ArtRow & { priority: number };
const toHeadline = (r: HeadRow): Headline => ({ id: r.id, title: r.title, source: r.source, url: r.url, summary: r.summary, topic: r.topic, priority: r.priority, publishedAt: r.published_at, createdAt: r.created_at });

export async function listHeadlines(): Promise<Headline[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('headlines').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as HeadRow[]).map(toHeadline);
  }
  return (await fileLoad<Headline>('headlines.json')).sort((a, b) => b.priority - a.priority || b.createdAt.localeCompare(a.createdAt));
}
export async function addHeadline(input: ArticleInput & { priority?: number }): Promise<Headline> {
  const f = articleFields(input);
  const priority = Number.isFinite(input.priority) ? Number(input.priority) : 0;
  const sb = getSupabase();
  if (sb) {
    // `headlines` has no `note` column — insert the article fields explicitly without it.
    const { data, error } = await sb
      .from('headlines')
      .insert({ title: f.title, source: f.source, url: f.url, summary: f.summary, topic: f.topic, published_at: f.published_at, priority })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toHeadline(data as HeadRow);
  }
  const h: Headline = { id: randomUUID(), createdAt: new Date().toISOString(), title: f.title, source: f.source, url: f.url, summary: f.summary, topic: f.topic, priority, publishedAt: f.published_at };
  await filePersist('headlines.json', [h, ...(await fileLoad<Headline>('headlines.json'))]);
  return h;
}
export async function removeHeadline(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('headlines').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad<Headline>('headlines.json');
  const next = rows.filter((x) => x.id !== id);
  if (next.length === rows.length) return false;
  await filePersist('headlines.json', next);
  return true;
}
