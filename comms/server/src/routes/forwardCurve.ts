import type { FastifyInstance } from 'fastify';
import {
  listForwardCurves, getLatestForwardCurve, saveForwardCurve, removeForwardCurve, getForwardTrend,
  type Commodity, type NewForwardCurve,
} from '../services/forwardCurveStore';
import { extractForwardCurve } from '../services/reportGenerator';

// The forward-curve (procurement-timing) data: the morning report's UK power
// baseload + NBP gas season tables. Operator pastes/uploads the report → AI
// extracts it → a dated snapshot is stored and surfaced on the dashboard and in
// client reports. Extraction degrades gracefully (never 500s).
export async function forwardCurveRoutes(app: FastifyInstance): Promise<void> {
  // Latest snapshot for the dashboard hero. null if nothing captured yet.
  app.get('/api/forward-curve/latest', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return (await getLatestForwardCurve()) ?? null;
  });

  // Snapshot history (metadata-light list of full snapshots).
  app.get('/api/forward-curve', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return listForwardCurves();
  });

  // Our own front-of-curve trend, built from saved snapshots over time.
  app.get('/api/forward-curve/trend', async (req, reply) => {
    const q = req.query as { commodity?: string };
    const commodity: Commodity = q.commodity === 'power' ? 'power' : 'gas';
    reply.header('Cache-Control', 'no-store');
    return getForwardTrend(commodity);
  });

  // Extract season tables from pasted text and/or an uploaded screenshot/PDF
  // image. Returns parsed curves for the operator to review before saving.
  app.post('/api/forward-curve/extract', async (req) => {
    const body = req.body as { text?: string; image?: { base64?: string; mime?: string } };
    const image = body.image?.base64 ? { base64: body.image.base64, mime: body.image.mime ?? 'image/png' } : undefined;
    return extractForwardCurve({ text: body.text, image });
  });

  // Save a reviewed snapshot (replaces any existing snapshot for the same date).
  app.post('/api/forward-curve', async (req, reply) => {
    const body = req.body as NewForwardCurve;
    if (!Array.isArray(body?.curves) || !body.curves.length) {
      reply.code(400);
      return { error: 'No curve data to save.' };
    }
    try {
      return await saveForwardCurve(body);
    } catch (e) {
      // e.g. every row coerced away (bad commodity casing / empty labels) — a
      // client input problem, so return a clean 400 the intake modal can show,
      // not a generic 500.
      reply.code(400);
      return { error: (e as Error).message || 'Could not save the snapshot.' };
    }
  });

  app.delete('/api/forward-curve/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await removeForwardCurve(id);
    if (!ok) reply.code(404);
    return { ok };
  });
}
