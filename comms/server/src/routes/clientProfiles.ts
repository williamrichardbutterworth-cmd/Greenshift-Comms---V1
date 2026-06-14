import type { FastifyInstance } from 'fastify';
import {
  listClientProfiles, getClientProfile, createClientProfile, updateClientProfile, removeClientProfile,
  appendActivity, type NewClientProfile, type ClientActivity,
} from '../services/clientProfilesStore';

// Client records — the CRM store (profile + stage + tracker + activity timeline).
export async function clientProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/client-profiles', async () => listClientProfiles());

  app.get('/api/client-profiles/:id', async (req, reply) => {
    const p = await getClientProfile((req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: 'Client profile not found.' });
    return p;
  });

  app.post('/api/client-profiles', async (req, reply) => {
    try {
      return await createClientProfile((req.body ?? {}) as NewClientProfile);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.patch('/api/client-profiles/:id', async (req, reply) => {
    const p = await updateClientProfile((req.params as { id: string }).id, (req.body ?? {}) as NewClientProfile & { activities?: ClientActivity[] });
    if (!p) return reply.code(404).send({ error: 'Client profile not found.' });
    return p;
  });

  // Append a single activity to the client's timeline (server assigns id + time).
  app.post('/api/client-profiles/:id/activities', async (req, reply) => {
    const p = await appendActivity((req.params as { id: string }).id, (req.body ?? {}) as Partial<ClientActivity>);
    if (!p) return reply.code(404).send({ error: 'Client profile not found.' });
    return p;
  });

  app.delete('/api/client-profiles/:id', async (req, reply) => {
    const ok = await removeClientProfile((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Client profile not found.' });
    return { ok: true };
  });
}
