import type { FastifyInstance } from 'fastify';
import { extractTranscript, analyzeSource, recommendNextStep, type ReportInputs } from '../services/reportGenerator';
import { draftReportNarrative } from '../services/reportNarrative';
import type { SourceKind, RecommendClient, NarrativeFact } from '../services/prompts';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
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

  // CRM: recommend the next best action for a client.
  app.post('/api/report/recommend', async (req) => {
    const body = req.body as { client?: RecommendClient };
    const client = body.client ?? { inputs: {}, stage: 'new', doneMilestones: [], recentActivity: [] };
    return recommendNextStep(client, []);
  });
}
