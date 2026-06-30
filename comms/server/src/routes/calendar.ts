import type { FastifyInstance } from 'fastify';
import {
  listCalendarEvents, getCalendarEvent, createCalendarEvent, updateCalendarEvent,
  removeCalendarEvent, upsertDetectedEvents,
  type NewCalendarEvent, type CalendarPatch,
} from '../services/calendarStore';
import { scanClientCalendar } from '../services/calendarScan';
import { getClientProfile } from '../services/clientProfilesStore';

// Calendar API. Detected events are mined from the client timeline (scan) and
// stored idempotently; contract-end / renewal-window markers are computed live in
// the web app and never hit this store. Scan degrades gracefully (never 500s).
export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  // All events, optionally scoped to one client (the client-tab view).
  app.get('/api/calendar', async (req, reply) => {
    const q = req.query as { clientProfileId?: string };
    reply.header('Cache-Control', 'no-store');
    return listCalendarEvents({ clientProfileId: q.clientProfileId || undefined });
  });

  app.get('/api/calendar/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const event = await getCalendarEvent(id);
    if (!event) { reply.code(404); return { error: 'Event not found.' }; }
    return event;
  });

  // Hand-create an event (the only manual entry point; detection does the rest).
  app.post('/api/calendar', async (req, reply) => {
    const body = req.body as NewCalendarEvent;
    if (!body?.title?.trim() || !body?.start?.trim() || !Number.isFinite(Date.parse(body.start))) {
      reply.code(400);
      return { error: 'An event needs a title and a valid start date.' };
    }
    try {
      return await createCalendarEvent(body);
    } catch (e) {
      reply.code(400);
      return { error: (e as Error).message || 'Could not create the event.' };
    }
  });

  // Mine one client's timeline → upsert detected events. Auto-triggered on
  // client-open; safe to re-run (idempotent on dedupeKey). Returns the saved rows
  // plus the provider so the caller can tell "found nothing" from "not configured".
  app.post('/api/calendar/scan/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = await getClientProfile(id);
    if (!profile) { reply.code(404); return { error: 'Client not found.' }; }
    const result = await scanClientCalendar(profile);
    const saved = await upsertDetectedEvents(id, result.events);
    return { events: saved, provider: result.provider, error: result.error, stats: result.stats };
  });

  app.patch('/api/calendar/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as CalendarPatch;
    // Guard an invalid start here (mirror POST): the store's coercion is lenient and
    // would otherwise silently relocate the event to its createdAt timestamp.
    if (body.start !== undefined && !Number.isFinite(Date.parse(body.start))) {
      reply.code(400);
      return { error: 'Invalid start date.' };
    }
    const updated = await updateCalendarEvent(id, body);
    if (!updated) { reply.code(404); return { error: 'Event not found.' }; }
    return updated;
  });

  // Detected events soft-delete (tombstone) so re-detection doesn't resurrect them.
  app.delete('/api/calendar/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await removeCalendarEvent(id);
    if (!res.removed) reply.code(404);
    return { ok: res.removed, tombstoned: res.tombstoned };
  });
}
