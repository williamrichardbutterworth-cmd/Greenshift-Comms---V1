import type { FastifyInstance } from 'fastify';
import { companiesHouseConfigured } from '../config';
import { searchCompanies, getCompany } from '../services/companiesHouse';
import { extractLoaFields, scrapeCompanyWebsite } from '../services/loaIntel';
import { clientIntake } from '../services/clientIntake';

// Letter-of-Authority intelligence: Companies House verification, company-website
// scrape, and AI extraction of LOA fields from free text. All endpoints degrade
// gracefully (return an {error}/empty shape) rather than 500.
export async function loaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/companies-house/status', async () => ({ configured: companiesHouseConfigured() }));

  app.get('/api/companies-house/search', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '');
    return searchCompanies(q);
  });

  app.get('/api/companies-house/company/:number', async (req) => {
    const { number } = req.params as { number: string };
    return getCompany(number);
  });

  app.post('/api/loa/scrape', async (req, reply) => {
    const body = (req.body ?? {}) as { url?: string; current?: Record<string, string> };
    if (!body.url?.trim()) { reply.code(400); return { error: 'A website URL is required.' }; }
    return scrapeCompanyWebsite(body.url, body.current);
  });

  app.post('/api/loa/extract', async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; current?: Record<string, string> };
    if (!body.text?.trim()) { reply.code(400); return { error: 'Some text to read is required.' }; }
    return extractLoaFields(body.text, body.current, false);
  });

  // Comprehensive new-client intake from website + transcript + uploaded bills.
  app.post('/api/client/intake', async (req) => {
    const b = (req.body ?? {}) as { website?: string; transcript?: string; fileTexts?: string[]; images?: { base64: string; mime?: string }[] };
    return clientIntake(b);
  });
}
