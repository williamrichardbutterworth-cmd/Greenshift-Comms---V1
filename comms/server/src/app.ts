import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { marketRoutes } from './routes/market';
import { reviewRoutes } from './routes/review';
import { newsRoutes } from './routes/news';
import { reportRoutes } from './routes/report';
import { ideasRoutes } from './routes/ideas';

// Builds the Fastify app WITHOUT listening or starting the scheduler, so the
// exact same app can run as a long-lived local server (index.ts) or be wrapped
// in a single Vercel serverless function (../../api/[...path].ts).
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: true }); // harmless: API is same-origin on Vercel

  app.get('/api/health', async () => ({
    ok: true,
    aiProvider: config.aiProvider,
    liveMarketData: config.useLiveMarketData,
    liveNews: config.useLiveNews,
  }));

  await app.register(marketRoutes);
  await app.register(reviewRoutes);
  await app.register(newsRoutes);
  await app.register(reportRoutes);
  await app.register(ideasRoutes);

  return app;
}
