import type { FastifyInstance } from 'fastify';
import { draftEmail } from '../services/emailDrafter';
import type { EmailMsg, ReportInputs } from '../services/prompts';

// Email dialogue management — draft the next email/response in a client thread.
export async function emailRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/email/draft', async (req) => {
    const b = (req.body ?? {}) as {
      inputs?: ReportInputs;
      history?: EmailMsg[];
      mode?: 'reply' | 'follow-up';
      instruction?: string;
      angles?: string[];
    };
    return draftEmail(b.inputs ?? {}, Array.isArray(b.history) ? b.history : [], {
      mode: b.mode === 'reply' ? 'reply' : 'follow-up',
      instruction: b.instruction,
      angles: Array.isArray(b.angles) ? b.angles : undefined,
    });
  });
}
