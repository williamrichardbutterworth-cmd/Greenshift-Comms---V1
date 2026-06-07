import { config } from '../../config';
import { RssNewsProvider } from './rss';
import { mockNews } from './mock';
import type { NewsItem } from './types';

const rss = new RssNewsProvider();

export async function getNews(limit = 12): Promise<NewsItem[]> {
  if (!config.useLiveNews) return mockNews();
  try {
    const items = await rss.getItems(limit);
    return items.length ? items : mockNews();
  } catch (err) {
    console.warn('[news] live feeds unavailable, using sample:', (err as Error).message);
    return mockNews();
  }
}

export type { NewsItem } from './types';
