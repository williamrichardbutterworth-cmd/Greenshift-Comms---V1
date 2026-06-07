import type { FastifyInstance } from 'fastify';
import { getNews } from '../providers/news';

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/news', async (req, reply) => {
    const limit = Number((req.query as { limit?: string })?.limit ?? 12);
    reply.header('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');
    return getNews(Number.isFinite(limit) ? limit : 12);
  });
}
