import type { FastifyInstance } from 'fastify';
import { getMarketSnapshot } from '../providers/marketData';
import { getGridSnapshot } from '../services/gridSnapshot';
import { getPriceHistory, SERIES_META, type SeriesKey, type RangeKey } from '../services/priceHistory';

export async function marketRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/market', async (_req, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    return getMarketSnapshot();
  });

  // UK generation map data: regional carbon intensity + per-interconnector flows.
  app.get('/api/grid', async (_req, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return getGridSnapshot();
  });

  // Which price series can be charted on a report.
  app.get('/api/market/series', async (_req, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=86400');
    return SERIES_META;
  });

  // Long-term price history for report charts: ?series=brent|gas|power&range=3m|6m|12m
  app.get('/api/market/history', async (req, reply) => {
    const q = req.query as { series?: string; range?: string };
    const allowed: SeriesKey[] = ['brent', 'gas', 'power'];
    const ranges: RangeKey[] = ['3m', '6m', '12m'];
    const series = allowed.includes(q.series as SeriesKey) ? (q.series as SeriesKey) : 'brent';
    const range = ranges.includes(q.range as RangeKey) ? (q.range as RangeKey) : '12m';
    reply.header('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=43200');
    return getPriceHistory(series, range);
  });
}
