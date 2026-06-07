import Parser from 'rss-parser';
import { RSS_FEEDS } from './feeds';
import type { NewsProvider, NewsItem } from './types';

const parser = new Parser({ timeout: 10000 });

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export class RssNewsProvider implements NewsProvider {
  readonly name = 'rss';

  async getItems(limit: number): Promise<NewsItem[]> {
    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const parsed = await parser.parseURL(feed.url);
        return (parsed.items ?? []).map<NewsItem>((it) => ({
          id: hash((it.link ?? '') + (it.title ?? '')),
          title: (it.title ?? '').trim(),
          source: feed.name,
          url: it.link ?? '',
          publishedAt: it.isoDate ?? it.pubDate ?? new Date().toISOString(),
          summary: (it.contentSnippet ?? it.content ?? '').slice(0, 280).trim() || undefined,
        }));
      }),
    );

    const items = results
      .filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value)
      .filter((i) => i.title);

    // De-dupe by title, newest first.
    const seen = new Set<string>();
    const unique = items
      .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
      .filter((i) => {
        const k = i.title.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    return unique.slice(0, limit);
  }
}
