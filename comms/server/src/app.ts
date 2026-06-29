import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { marketRoutes } from './routes/market';
import { reviewRoutes } from './routes/review';
import { newsRoutes } from './routes/news';
import { reportRoutes } from './routes/report';
import { reportProjectRoutes } from './routes/reportProjects';
import { clientProfileRoutes } from './routes/clientProfiles';
import { fileRoutes } from './routes/files';
import { ideasRoutes } from './routes/ideas';
import { forwardCurveRoutes } from './routes/forwardCurve';
import { loaRoutes } from './routes/loa';
import { rfqRoutes } from './routes/rfq';
import { emailRoutes } from './routes/email';
import { billRoutes } from './routes/bill';

// Builds the Fastify app WITHOUT listening or starting the scheduler, so the
// exact same app can run as a long-lived local server (index.ts) or be wrapped
// in a single Vercel serverless function (../../api/[...path].ts).
export async function buildApp(): Promise<FastifyInstance> {
  // 12MB body cap: a ~6MB file (the upload cap) is ~8MB once base64-encoded, plus the
  // JSON envelope — so 8MB would 413 a max-size upload before validation. (Vercel still
  // caps the request at ~4.5MB on Hobby, so cloud uploads are smaller in practice.)
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, { origin: true }); // harmless: API is same-origin on Vercel

  // Friendly pointer for anyone opening the backend directly. In prod the
  // Vercel rewrites send "/" to the SPA, so this only ever serves in local dev.
  app.get('/', async () => ({
    ok: true,
    service: 'Comms API',
    health: '/api/health',
    note: 'This is the backend — the app itself runs on the web dev server (local: http://localhost:5273).',
  }));

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
  await app.register(reportProjectRoutes);
  await app.register(clientProfileRoutes);
  await app.register(fileRoutes);
  await app.register(ideasRoutes);
  await app.register(forwardCurveRoutes);
  await app.register(loaRoutes);
  await app.register(rfqRoutes);
  await app.register(emailRoutes);
  await app.register(billRoutes);

  return app;
}
