import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/src/app';

type Method = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | 'OPTIONS';

// Single catch-all Vercel serverless function that serves the whole API. Wrapping
// the existing Fastify app in ONE function (rather than many) keeps us under
// Vercel's function limits and reuses every route/service unchanged.
//
// We dispatch via Fastify's inject() instead of piping the raw request stream:
// Vercel's Node runtime has already parsed the JSON body into req.body, so we
// hand that to Fastify as the payload — no fragile stream re-reading.

let appPromise: Promise<FastifyInstance> | null = null;
function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  const app = await getApp();
  const method = (req.method?.toUpperCase() ?? 'GET') as Method;

  // Forward headers but let Fastify recompute the body length.
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  delete headers['connection'];

  let payload: string | undefined;
  if (req.body != null && method !== 'GET' && method !== 'HEAD') {
    payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  const response = await app.inject({
    method,
    url: req.url ?? '/',
    headers: headers as Record<string, string>,
    payload,
  });

  res.statusCode = response.statusCode;
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined && key.toLowerCase() !== 'transfer-encoding') {
      res.setHeader(key, value as string | string[] | number);
    }
  }
  res.end(response.rawPayload);
}
