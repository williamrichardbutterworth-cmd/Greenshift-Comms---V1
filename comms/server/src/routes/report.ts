import type { FastifyInstance } from 'fastify';
import { draftReport, type ReportInputs } from '../services/reportGenerator';
import type { NewsItem } from '../providers/news/types';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // AI drafts the narrative; the frontend renders the final PDF/Word client-side.
  app.post('/api/report/draft', async (req) => {
    const body = req.body as { inputs?: ReportInputs; selectedNews?: NewsItem[] };
    return draftReport(body.inputs ?? {}, body.selectedNews ?? []);
  });
}
