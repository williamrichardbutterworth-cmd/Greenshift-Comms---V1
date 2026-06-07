import type { FastifyInstance } from 'fastify';
import { draftReport, assembleReport, editText, type ReportInputs } from '../services/reportGenerator';
import type { AssembleContext, EditAction } from '../services/prompts';
import type { NewsItem } from '../providers/news/types';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // Legacy 4-section draft (kept for back-compat); the frontend renders client-side.
  app.post('/api/report/draft', async (req) => {
    const body = req.body as { inputs?: ReportInputs; selectedNews?: NewsItem[] };
    return draftReport(body.inputs ?? {}, body.selectedNews ?? []);
  });

  // Section-based assembly from the attached context tray. Degrades gracefully
  // (placeholder skeleton) on any AI failure — never 500s.
  app.post('/api/report/assemble', async (req) => {
    const body = req.body as { inputs?: ReportInputs; context?: AssembleContext };
    return assembleReport(body.inputs ?? {}, body.context ?? {});
  });

  // Inline AI edit of a selection / section, or a chart caption.
  app.post('/api/report/edit', async (req) => {
    const body = req.body as { action?: EditAction; text?: string; instruction?: string };
    return editText(body.action ?? 'rewrite', body.text ?? '', { instruction: body.instruction });
  });
}
