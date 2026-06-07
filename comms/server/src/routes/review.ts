import type { FastifyInstance } from 'fastify';
import { getDailyReview } from '../services/dailyReview';

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  // CDN-cached for 6h so the (AI-generated) brief is produced at most a few
  // times a day across the whole team, even on serverless — no DB needed.
  app.get('/api/daily-review', async (_req, reply) => {
    reply.header('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=43200');
    return getDailyReview(false);
  });
  app.post('/api/daily-review/refresh', async () => getDailyReview(true));
}
