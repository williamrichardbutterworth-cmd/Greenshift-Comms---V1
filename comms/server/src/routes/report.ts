import type { FastifyInstance } from 'fastify';
import {
  draftReport, assembleReport, editText, extractTranscript, analyzeSource, recommendNextStep, type ReportInputs,
} from '../services/reportGenerator';
import { listTemplates } from '../services/templatesStore';
import { draftReportNarrative } from '../services/reportNarrative';
import type { AssembleContext, EditAction, SourceKind, RecommendClient, NarrativeFact } from '../services/prompts';
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

  // Mine a pasted call transcript for report-relevant client details.
  app.post('/api/report/transcript-extract', async (req) => {
    const body = req.body as { transcript?: string };
    return extractTranscript(body.transcript ?? '');
  });

  // CRM intake: analyse a pasted/uploaded source (transcript / bill / email) for
  // client fields + a timeline summary + suggested milestones. Never 500s.
  app.post('/api/report/analyze', async (req) => {
    const body = req.body as { text?: string; kind?: SourceKind; inputs?: ReportInputs };
    return analyzeSource(body.text ?? '', body.kind ?? 'auto', body.inputs);
  });

  // Report engine: AI-draft the narrative tokens, grounded in the client + figures.
  app.post('/api/report/narrative', async (req) => {
    const body = req.body as { kind?: string; clientProfileId?: string; facts?: NarrativeFact[]; values?: Record<string, string> };
    return draftReportNarrative({ kind: body.kind ?? '', clientProfileId: body.clientProfileId, facts: body.facts ?? [], values: body.values ?? {} });
  });

  // CRM: recommend the next best action for a client (templates loaded server-side).
  app.post('/api/report/recommend', async (req) => {
    const body = req.body as { client?: RecommendClient };
    const templates = (await listTemplates()).map((t) => ({ id: t.id, name: t.name, channel: t.channel, description: t.description }));
    const client = body.client ?? { inputs: {}, stage: 'new', doneMilestones: [], recentActivity: [] };
    return recommendNextStep(client, templates);
  });
}
