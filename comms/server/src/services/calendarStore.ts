import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Calendar events — the durable rows behind the Calendar tab. A broker never
// types these in: detection mines the client timeline (transcripts/notes/emails)
// for forward commitments and writes provenance-backed events here. Contract-end
// and renewal-window markers are NOT stored — the web app computes those live
// from each meter's contractEnd, so editing a date instantly reshapes the view
// with zero stale rows. This store therefore holds detected + manual events only.
//
// Idempotency is the whole game: every detected event carries a deterministic
// `dedupeKey` built from immutable provenance (client + kind + source activity +
// due-date), NOT from the model's free-text title — so re-running the scan
// UPDATES the same row instead of minting a duplicate when wording drifts. A
// user's action on an event (done/dismissed/snoozed) is preserved across
// re-scans, and a "deleted" detected event becomes a tombstone (status
// 'dismissed', row kept) so the next scan no-ops rather than resurrecting it.
//
// Same dual Supabase/file-fallback pattern as the rest of the app.

export type CalendarKind =
  | 'callback'        // a verbally-agreed call/meeting at a stated time
  | 'deadline'        // something the CLIENT owes us by a date (bill, signed LOA, readings)
  | 'our-action'      // something WE owe the client (send pricing, follow up)
  | 'manual';         // hand-created by the operator
const KINDS: CalendarKind[] = ['callback', 'deadline', 'our-action', 'manual'];

export type CalendarStatus = 'open' | 'done' | 'dismissed' | 'snoozed';
const STATUSES: CalendarStatus[] = ['open', 'done', 'dismissed', 'snoozed'];

export type CalendarOrigin = 'detected' | 'manual';
export type CalendarConfidence = 'high' | 'medium' | 'low';

export interface CalendarEvent {
  id: string;
  /** Deterministic idempotency key (provenance-based for detected events; the id for manual). */
  dedupeKey: string;
  title: string;
  /** ISO datetime — the due/scheduled moment. */
  start: string;
  end?: string | null;
  /** True when only a date (no time) was found — render as an all-day chip. */
  allDay: boolean;
  kind: CalendarKind;
  origin: CalendarOrigin;
  status: CalendarStatus;
  clientProfileId?: string | null;
  /** MPAN/MPRN when an event pins a specific supply point (rare for detected). */
  meterRef?: string | null;
  /** Verbatim quote the date was lifted from (provenance; never invented). */
  source?: string | null;
  /** The ClientActivity.id this was mined from — lets the UI deep-link the timeline entry. */
  sourceActivityId?: string | null;
  confidence?: CalendarConfidence | null;
  note?: string | null;
  /** Owner of the commitment (nullable; single-user default today, future-proofs a workload view). */
  ownerId?: string | null;
  /** When a snoozed event should wake back to 'open'. */
  snoozedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The shape detection emits — no id/status yet; the store assigns those. */
export interface DetectedEvent {
  dedupeKey: string;
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  kind: CalendarKind;
  clientProfileId: string;
  meterRef?: string | null;
  source?: string | null;
  sourceActivityId?: string | null;
  confidence?: CalendarConfidence | null;
}

export interface NewCalendarEvent {
  title?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  kind?: CalendarKind;
  clientProfileId?: string | null;
  note?: string | null;
  ownerId?: string | null;
}

export interface CalendarPatch {
  title?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  status?: CalendarStatus;
  note?: string | null;
  snoozedUntil?: string | null;
  ownerId?: string | null;
}

const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoOr = (v: unknown, fallback: string): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};
const coerceKind = (v: unknown): CalendarKind => (KINDS.includes(v as CalendarKind) ? (v as CalendarKind) : 'manual');
const coerceStatus = (v: unknown): CalendarStatus => (STATUSES.includes(v as CalendarStatus) ? (v as CalendarStatus) : 'open');
const coerceConf = (v: unknown): CalendarConfidence | null =>
  v === 'high' || v === 'medium' || v === 'low' ? v : null;

function normalise(p: Partial<CalendarEvent> & { id: string; createdAt: string }): CalendarEvent {
  const created = p.createdAt;
  return {
    id: p.id,
    dedupeKey: str(p.dedupeKey, 200) || p.id,
    title: str(p.title, 240) || 'Reminder',
    start: isoOr(p.start, created),
    end: typeof p.end === 'string' && Date.parse(p.end) ? new Date(p.end).toISOString() : null,
    // Default true (a date-only event is all-day) to match the schema column default.
    allDay: p.allDay !== false,
    kind: coerceKind(p.kind),
    origin: p.origin === 'detected' ? 'detected' : 'manual',
    status: coerceStatus(p.status),
    clientProfileId: str(p.clientProfileId, 64) || null,
    meterRef: str(p.meterRef, 64) || null,
    source: typeof p.source === 'string' ? p.source.slice(0, 600) : null,
    sourceActivityId: str(p.sourceActivityId, 64) || null,
    confidence: coerceConf(p.confidence),
    note: typeof p.note === 'string' ? p.note.slice(0, 1000) : null,
    ownerId: str(p.ownerId, 64) || null,
    snoozedUntil: typeof p.snoozedUntil === 'string' && Date.parse(p.snoozedUntil) ? new Date(p.snoozedUntil).toISOString() : null,
    createdAt: created,
    updatedAt: p.updatedAt ?? created,
  };
}

// ── Supabase row mapping (camelCase ⇆ snake_case — keep BOTH mappers in sync) ──
type Row = {
  id: string; dedupe_key: string | null; title: string | null; start_at: string; end_at: string | null;
  all_day: boolean | null; kind: string | null; origin: string | null; status: string | null;
  client_profile_id: string | null; meter_ref: string | null; source: string | null;
  source_activity_id: string | null; confidence: string | null; note: string | null;
  owner_id: string | null; snoozed_until: string | null; created_at: string; updated_at: string | null;
};
const rowToEvent = (r: Row): CalendarEvent => normalise({
  id: r.id, dedupeKey: r.dedupe_key ?? undefined, title: r.title ?? undefined, start: r.start_at,
  end: r.end_at, allDay: r.all_day ?? undefined, kind: (r.kind as CalendarKind) ?? undefined,
  origin: (r.origin as CalendarOrigin) ?? undefined, status: (r.status as CalendarStatus) ?? undefined,
  clientProfileId: r.client_profile_id ?? undefined, meterRef: r.meter_ref ?? undefined,
  source: r.source ?? undefined, sourceActivityId: r.source_activity_id ?? undefined,
  confidence: (r.confidence as CalendarConfidence) ?? undefined, note: r.note ?? undefined,
  ownerId: r.owner_id ?? undefined, snoozedUntil: r.snoozed_until ?? undefined,
  createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
});
const eventToRow = (e: CalendarEvent) => ({
  id: e.id, dedupe_key: e.dedupeKey, title: e.title, start_at: e.start, end_at: e.end ?? null,
  all_day: e.allDay, kind: e.kind, origin: e.origin, status: e.status,
  client_profile_id: e.clientProfileId ?? null, meter_ref: e.meterRef ?? null, source: e.source ?? null,
  source_activity_id: e.sourceActivityId ?? null, confidence: e.confidence ?? null, note: e.note ?? null,
  owner_id: e.ownerId ?? null, snoozed_until: e.snoozedUntil ?? null,
  created_at: e.createdAt, updated_at: e.updatedAt,
});

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'calendar-events.json');
let fileCache: CalendarEvent[] | null = null;

async function fileLoad(): Promise<CalendarEvent[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed)
      ? (parsed as (Partial<CalendarEvent> & { id: string; createdAt: string })[]).map(normalise)
      : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function filePersist(rows: CalendarEvent[]): Promise<void> {
  fileCache = rows;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, FILE);
}
const byStart = (a: CalendarEvent, b: CalendarEvent) => (a.start || '').localeCompare(b.start || '');

export async function listCalendarEvents(opts: { clientProfileId?: string } = {}): Promise<CalendarEvent[]> {
  const sb = getSupabase();
  if (sb) {
    let q = sb.from('calendar_events').select('*').order('start_at', { ascending: true });
    if (opts.clientProfileId) q = q.eq('client_profile_id', opts.clientProfileId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToEvent);
  }
  const all = (await fileLoad()).slice().sort(byStart);
  return opts.clientProfileId ? all.filter((e) => e.clientProfileId === opts.clientProfileId) : all;
}

export async function getCalendarEvent(id: string): Promise<CalendarEvent | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('calendar_events').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToEvent(data as Row) : null;
  }
  return (await fileLoad()).find((e) => e.id === id) ?? null;
}

export async function createCalendarEvent(input: NewCalendarEvent): Promise<CalendarEvent> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const event = normalise({
    id,
    dedupeKey: id, // manual events key on their own id — they never re-detect
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    kind: coerceKind(input.kind),
    origin: 'manual',
    status: 'open',
    clientProfileId: input.clientProfileId,
    note: input.note,
    ownerId: input.ownerId,
    createdAt: now,
    updatedAt: now,
  });
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('calendar_events').insert(eventToRow(event)).select().single();
    if (error) throw new Error(error.message);
    return rowToEvent(data as Row);
  }
  await filePersist([event, ...(await fileLoad())]);
  return event;
}

export async function updateCalendarEvent(id: string, patch: CalendarPatch): Promise<CalendarEvent | null> {
  const current = await getCalendarEvent(id);
  if (!current) return null;
  const next: CalendarEvent = normalise({
    ...current,
    title: patch.title !== undefined ? patch.title : current.title,
    start: patch.start !== undefined ? patch.start : current.start,
    end: patch.end !== undefined ? patch.end : current.end,
    allDay: patch.allDay !== undefined ? patch.allDay : current.allDay,
    status: patch.status !== undefined ? patch.status : current.status,
    note: patch.note !== undefined ? patch.note : current.note,
    snoozedUntil: patch.snoozedUntil !== undefined ? patch.snoozedUntil : current.snoozedUntil,
    ownerId: patch.ownerId !== undefined ? patch.ownerId : current.ownerId,
    updatedAt: new Date().toISOString(),
  });
  return persist(id, next);
}

async function persist(id: string, next: CalendarEvent): Promise<CalendarEvent | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('calendar_events').update(eventToRow(next)).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToEvent(data as Row) : null;
  }
  const rows = await fileLoad();
  const idx = rows.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  rows[idx] = next;
  await filePersist(rows);
  return next;
}

// Delete semantics protect detection idempotency: a DETECTED event becomes a
// tombstone (status 'dismissed', row kept by its stable dedupeKey) so the next
// scan finds it and no-ops instead of resurrecting it. Only a manual event with
// no source activity is truly removed.
export async function removeCalendarEvent(id: string): Promise<{ removed: boolean; tombstoned: boolean }> {
  const current = await getCalendarEvent(id);
  if (!current) return { removed: false, tombstoned: false };
  if (current.origin === 'detected') {
    await updateCalendarEvent(id, { status: 'dismissed' });
    return { removed: true, tombstoned: true };
  }
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('calendar_events').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return { removed: (count ?? 0) > 0, tombstoned: false };
  }
  const rows = await fileLoad();
  const next = rows.filter((e) => e.id !== id);
  await filePersist(next);
  return { removed: next.length !== rows.length, tombstoned: false };
}

// Write detection results back idempotently. For each incoming event we look up
// the existing row by dedupeKey (within the client) and UPDATE only the mutable,
// model-derived columns — title/start/source/confidence/kind — while preserving
// the operator's status, snooze, note and the original id/createdAt. New keys are
// inserted as 'open'. This is what makes a re-scan a no-op for unchanged
// commitments and a tombstone-respecting reconcile for changed ones.
export async function upsertDetectedEvents(clientProfileId: string, incoming: DetectedEvent[]): Promise<CalendarEvent[]> {
  if (!incoming.length) return [];
  const existing = await listCalendarEvents({ clientProfileId });
  const byKey = new Map(existing.map((e) => [e.dedupeKey, e]));
  const now = new Date().toISOString();
  const merged: CalendarEvent[] = incoming.map((inc) => {
    const prev = byKey.get(inc.dedupeKey);
    if (prev) {
      // Preserve status/snooze/note/id/createdAt; refresh the detected fields.
      return normalise({
        ...prev,
        title: inc.title,
        start: inc.start,
        end: inc.end,
        allDay: inc.allDay,
        kind: inc.kind,
        source: inc.source,
        sourceActivityId: inc.sourceActivityId,
        confidence: inc.confidence,
        meterRef: inc.meterRef,
        updatedAt: now,
      });
    }
    return normalise({
      ...inc,
      id: randomUUID(),
      origin: 'detected',
      status: 'open',
      clientProfileId,
      createdAt: now,
      updatedAt: now,
    });
  });

  const sb = getSupabase();
  if (sb) {
    // Unique index on dedupe_key makes this a safe insert-or-update.
    const { data, error } = await sb.from('calendar_events').upsert(merged.map(eventToRow), { onConflict: 'dedupe_key' }).select();
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToEvent);
  }
  const rows = await fileLoad();
  for (const m of merged) {
    const idx = rows.findIndex((e) => e.id === m.id || e.dedupeKey === m.dedupeKey);
    if (idx >= 0) rows[idx] = m;
    else rows.push(m);
  }
  await filePersist(rows);
  return merged;
}
