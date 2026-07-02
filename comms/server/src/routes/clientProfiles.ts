import type { FastifyInstance } from 'fastify';
import {
  listClientProfiles, getClientProfile, createClientProfile, updateClientProfile, removeClientProfile,
  appendActivity, type NewClientProfile, type ClientActivity,
} from '../services/clientProfilesStore';
import { logCallToClient, runClientIntake } from '../services/clientCapture';
import type { SourceKind } from '../services/prompts';

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

  // "Log this call" in ONE round trip: persist the verbatim text, run ONE unified
  // extraction, merge the profile server-side (fill blanks; meters by MPAN/MPRN),
  // append the timeline entry, and upsert spoken commitments onto the calendar.
  // AI failure degrades to analysis.error on a still-successful capture — never 500s.
  app.post('/api/client-profiles/:id/log-call', async (req, reply) => {
    const body = (req.body ?? {}) as { text?: string; kind?: SourceKind; fileId?: string };
    const r = await logCallToClient((req.params as { id: string }).id, body);
    if (!r) return reply.code(404).send({ error: 'Client profile not found.' });
    return r;
  });

  // The full new-client intake against an (already-created) provisional profile:
  // website scrape + transcript + uploaded media → one extraction, merged + logged
  // server-side, first-call commitments straight onto the calendar. Same
  // degrade-not-500 contract as log-call.
  app.post('/api/client-profiles/:id/intake-run', async (req, reply) => {
    const body = (req.body ?? {}) as { website?: string; transcript?: string; fileIds?: string[]; images?: { base64: string; mime?: string }[] };
    const r = await runClientIntake((req.params as { id: string }).id, body);
    if (!r) return reply.code(404).send({ error: 'Client profile not found.' });
    return r;
  });

  app.delete('/api/client-profiles/:id', async (req, reply) => {
    const ok = await removeClientProfile((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'Client profile not found.' });
    return { ok: true };
  });
}
