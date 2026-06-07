import type { NewsItem } from './types';
import { classifyTopic } from './classify';

// Sample stories (incl. a geopolitical example) so the feed shows something
// before live feeds are wired / when offline.
export function mockNews(): NewsItem[] {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  const items: NewsItem[] = [
    {
      id: 'mock-hormuz',
      title: 'Strait of Hormuz tensions lift European gas prices',
      source: 'Sample data',
      url: '',
      publishedAt: ago(3),
      summary:
        'Renewed shipping-route tensions have supported wholesale gas this week, with roughly a fifth of global LNG transiting the Strait of Hormuz.',
    },
    {
      id: 'mock-wind',
      title: 'High wind output pulls GB day-ahead power lower',
      source: 'Sample data',
      url: '',
      publishedAt: ago(8),
      summary: 'Strong wind generation eased GB power prices, with renewables covering a large share of demand.',
    },
    {
      id: 'mock-storage',
      title: 'EU gas storage ahead of seasonal norms',
      source: 'Sample data',
      url: '',
      publishedAt: ago(20),
      summary: 'Comfortable storage levels are tempering price spikes despite colder forecasts.',
    },
  ];
  return items.map((i) => ({ ...i, topic: classifyTopic(i.title, i.summary ?? '') }));
}
