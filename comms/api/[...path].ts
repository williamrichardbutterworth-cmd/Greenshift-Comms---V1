import type { IncomingMessage, ServerResponse } from 'node:http';

// Single catch-all Vercel serverless function serving the whole API. The Fastify
// app is imported dynamically inside the try/catch so that even an import/init
// failure is surfaced as a JSON error instead of an opaque 500.

type Method = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT' | 'OPTIONS';

let appPromise: Promise<any> | null = null;
function getApp(): Promise<any> {
  if (!appPromise) {
    appPromise = (async () => {
      const { buildApp } = await import('../server/dist/app.js');
      const app = await buildApp();
      await app.ready();
      return app;
    })();
  }
  return appPromise;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    const method = (req.method?.toUpperCase() ?? 'GET') as Method;

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
  } catch (e: any) {
    // Temporary: expose the real error so we can diagnose the serverless build.
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      error: 'function_error',
      message: String(e?.message ?? e),
      stack: String(e?.stack ?? '').split('\n').slice(0, 8),
    }));
  }
}
