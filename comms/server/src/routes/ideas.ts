import type { FastifyInstance } from 'fastify';
import {
  listIdeas, addIdea, voteIdea, setIdeaStatus, deleteIdea,
  IDEA_CATEGORIES, IDEA_STATUSES, type IdeaStatus, type NewIdea,
} from '../services/ideasStore';
import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { ideasSummaryPrompt } from '../services/prompts';

export async function ideasRoutes(app: FastifyInstance): Promise<void> {
  // Form options (categories + statuses) so the UI stays in sync with the store.
  app.get('/api/ideas/meta', async () => ({ categories: IDEA_CATEGORIES, statuses: IDEA_STATUSES }));

  app.get('/api/ideas', async () => listIdeas());

  app.post('/api/ideas', async (req, reply) => {
    try {
      return await addIdea((req.body ?? {}) as NewIdea);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/ideas/:id/vote', async (req, reply) => {
    const idea = await voteIdea((req.params as { id: string }).id);
    if (!idea) return reply.code(404).send({ error: 'Idea not found.' });
    return idea;
  });

  app.patch('/api/ideas/:id', async (req, reply) => {
    const status = (req.body as { status?: IdeaStatus })?.status;
    try {
      const idea = await setIdeaStatus((req.params as { id: string }).id, status as IdeaStatus);
      if (!idea) return reply.code(404).send({ error: 'Idea not found.' });
      return idea;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/ideas/:id', async (req, reply) => {
    const ok = await deleteIdea((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Idea not found.' });
    return { ok: true };
  });

  // AI digest: cluster the ideas into prioritised themes. Degrades gracefully.
  app.post('/api/ideas/summary', async () => {
    const ideas = await listIdeas();
    if (!ideas.length) return { configured: aiConfigured(), summary: 'No ideas yet — add the first one above.' };
    if (!aiConfigured()) {
      return { configured: false, summary: 'Add an AI key (server/.env) to auto-summarise themes and priorities.' };
    }
    const ai = getAI();
    const { system, prompt } = ideasSummaryPrompt(ideas);
    const summary = await ai.generateText({ system, prompt, maxTokens: 1000 });
    return { configured: true, provider: ai.name, summary };
  });
}
