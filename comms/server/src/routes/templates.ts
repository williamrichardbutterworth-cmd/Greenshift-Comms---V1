import type { FastifyInstance } from 'fastify';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate, removeTemplate, type NewTemplate,
} from '../services/templatesStore';

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/report/templates', async () => listTemplates());

  app.get('/api/report/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await getTemplate(id);
    if (!t) return reply.code(404).send({ error: 'Template not found' });
    return t;
  });

  app.post('/api/report/templates', async (req) => createTemplate((req.body as NewTemplate) ?? {}));

  app.patch('/api/report/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await updateTemplate(id, (req.body as NewTemplate) ?? {});
    if (!t) return reply.code(404).send({ error: 'Template not found' });
    return t;
  });

  app.delete('/api/report/templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await removeTemplate(id);
    if (!ok) return reply.code(404).send({ error: 'Template not found' });
    return { ok: true };
  });
}
