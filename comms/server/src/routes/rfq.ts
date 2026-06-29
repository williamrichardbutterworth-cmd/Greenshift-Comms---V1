import type { FastifyInstance } from 'fastify';
import { extractRfqFields, scrapeRfqWebsite } from '../services/rfqIntel';

// RFQ (Lead Generation Form) intelligence: AI extraction of qualification answers from a
// call transcript / notes, and basic info from a company website. Degrades gracefully
// (returns an {error}/empty shape) rather than 500 — mirrors the LOA routes.
export async function rfqRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/rfq/scrape', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: string; current?: Record<string, string> };
    if (!body.url?.trim()) { reply.code(400); return { error: 'A website URL is required.' }; }
    return scrapeRfqWebsite(body.url, body.current);
  });

  app.post('/api/rfq/extract', async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; current?: Record<string, string> };
    if (!body.text?.trim()) { reply.code(400); return { error: 'Some text to read is required.' }; }
    return extractRfqFields(body.text, body.current, false);
  });
}
