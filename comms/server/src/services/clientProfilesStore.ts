import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Client records — the core of the CRM. A client carries the energy/company
// details (`inputs`, the ReportInputs shape), a pipeline `stage`, a `tracker` of
// milestones (key → ISO date completed, or null), and an `activities` timeline of
// all dialogue/progress. Same dual Supabase/file-fallback pattern as the rest.

export type ClientStage = 'new' | 'profiling' | 'loa' | 'data' | 'tender' | 'proposal' | 'won' | 'lost';
const STAGES: ClientStage[] = ['new', 'profiling', 'loa', 'data', 'tender', 'proposal', 'won', 'lost'];

export type ActivityType =
  | 'note' | 'transcript' | 'email-sent' | 'email-received' | 'document' | 'file' | 'stage' | 'milestone' | 'recommendation';

export interface ClientActivity {
  id: string;
  at: string;
  type: ActivityType;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface ClientProfile {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  stage: ClientStage;
  /** Milestone key → ISO date completed (or null if not done). */
  tracker: Record<string, string | null>;
  activities: ClientActivity[];
  createdAt: string;
  updatedAt: string;
}

export interface NewClientProfile {
  name?: string;
  inputs?: Record<string, unknown>;
  stage?: ClientStage;
  tracker?: Record<string, string | null>;
}

const clampName = (s: unknown, inputs?: Record<string, unknown>): string => {
  const v = typeof s === 'string' ? s.trim() : '';
  const company = inputs && typeof inputs.companyName === 'string' ? inputs.companyName.trim() : '';
  return (v || company || 'Untitled client').slice(0, 200);
};
const coerceStage = (s: unknown): ClientStage => (STAGES.includes(s as ClientStage) ? (s as ClientStage) : 'new');
const MAX_ACTIVITIES = 300;

function coerceActivity(a: Partial<ClientActivity>): ClientActivity {
  return {
    id: a.id || randomUUID(),
    at: a.at || new Date().toISOString(),
    type: (a.type as ActivityType) || 'note',
    title: (typeof a.title === 'string' ? a.title : '').slice(0, 240) || 'Update',
    detail: typeof a.detail === 'string' ? a.detail.slice(0, 4000) : undefined,
    meta: a.meta && typeof a.meta === 'object' ? a.meta : undefined,
  };
}

// Defaults for legacy rows created before the CRM fields existed.
function normalise(p: Partial<ClientProfile> & { id: string; name: string; createdAt: string }): ClientProfile {
  return {
    id: p.id,
    name: p.name,
    inputs: p.inputs ?? {},
    stage: coerceStage(p.stage),
    tracker: p.tracker && typeof p.tracker === 'object' ? p.tracker : {},
    activities: Array.isArray(p.activities) ? p.activities.map(coerceActivity) : [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt ?? p.createdAt,
  };
}

type Row = {
  id: string; name: string; inputs: Record<string, unknown>; stage: string | null;
  tracker: Record<string, string | null> | null; activities: ClientActivity[] | null;
  created_at: string; updated_at: string | null;
};
const rowToProfile = (r: Row): ClientProfile => normalise({
  id: r.id, name: r.name, inputs: r.inputs ?? {}, stage: (r.stage as ClientStage) ?? 'new',
  tracker: r.tracker ?? {}, activities: r.activities ?? [], createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
});
const profileToRow = (p: ClientProfile) => ({
  id: p.id, name: p.name, inputs: p.inputs, stage: p.stage, tracker: p.tracker,
  activities: p.activities, created_at: p.createdAt, updated_at: p.updatedAt,
});

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'client-profiles.json');
let fileCache: ClientProfile[] | null = null;

async function fileLoad(): Promise<ClientProfile[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed)
      ? (parsed as (Partial<ClientProfile> & { id: string; name: string; createdAt: string })[]).map(normalise)
      : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function filePersist(rows: ClientProfile[]): Promise<void> {
  fileCache = rows;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, FILE);
}
const byUpdated = (a: ClientProfile, b: ClientProfile) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

export async function listClientProfiles(): Promise<ClientProfile[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').select('*').order('updated_at', { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToProfile);
  }
  return (await fileLoad()).slice().sort(byUpdated);
}

export async function getClientProfile(id: string): Promise<ClientProfile | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToProfile(data as Row) : null;
  }
  return (await fileLoad()).find((p) => p.id === id) ?? null;
}

export async function createClientProfile(input: NewClientProfile): Promise<ClientProfile> {
  const now = new Date().toISOString();
  const profile: ClientProfile = {
    id: randomUUID(),
    name: clampName(input.name, input.inputs),
    inputs: input.inputs ?? {},
    stage: coerceStage(input.stage),
    tracker: input.tracker ?? {},
    activities: [coerceActivity({ type: 'note', title: 'Client created', at: now })],
    createdAt: now,
    updatedAt: now,
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').insert(profileToRow(profile)).select().single();
    if (error) throw new Error(error.message);
    return rowToProfile(data as Row);
  }
  await filePersist([profile, ...(await fileLoad())]);
  return profile;
}

// Generic patch — name / inputs / stage / tracker / activities (full replace).
export async function updateClientProfile(id: string, input: Partial<NewClientProfile & { activities: ClientActivity[] }>): Promise<ClientProfile | null> {
  const current = await getClientProfile(id);
  if (!current) return null;
  // Only honour an explicitly-provided VALID stage — an invalid one is a no-op,
  // never a silent demotion to 'new' (which would also write a false timeline entry).
  const validStage = input.stage !== undefined && STAGES.includes(input.stage) ? input.stage : undefined;
  const stageChanged = validStage !== undefined && validStage !== current.stage;
  const next: ClientProfile = {
    ...current,
    name: input.name !== undefined || input.inputs !== undefined ? clampName(input.name ?? current.name, input.inputs ?? current.inputs) : current.name,
    inputs: input.inputs !== undefined ? input.inputs : current.inputs,
    stage: validStage ?? current.stage,
    tracker: input.tracker !== undefined ? input.tracker : current.tracker,
    activities: input.activities !== undefined ? input.activities.map(coerceActivity) : current.activities,
    updatedAt: new Date().toISOString(),
  };
  // Auto-log a stage change unless the caller already supplied its own activities.
  if (stageChanged && input.activities === undefined) {
    next.activities = [coerceActivity({ type: 'stage', title: `Stage → ${next.stage}`, meta: { stage: next.stage } }), ...next.activities].slice(0, MAX_ACTIVITIES);
  }
  return persist(id, next);
}

// Prepend an activity (server assigns id + timestamp) and bump updatedAt.
export async function appendActivity(id: string, activity: Partial<ClientActivity>): Promise<ClientProfile | null> {
  const current = await getClientProfile(id);
  if (!current) return null;
  const next: ClientProfile = {
    ...current,
    activities: [coerceActivity(activity), ...current.activities].slice(0, MAX_ACTIVITIES),
    updatedAt: new Date().toISOString(),
  };
  return persist(id, next);
}

async function persist(id: string, next: ClientProfile): Promise<ClientProfile | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles')
      .update({ name: next.name, inputs: next.inputs, stage: next.stage, tracker: next.tracker, activities: next.activities, updated_at: next.updatedAt })
      .eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToProfile(data as Row) : null;
  }
  const rows = await fileLoad();
  const idx = rows.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  rows[idx] = next;
  await filePersist(rows);
  return next;
}

export async function removeClientProfile(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('client_profiles').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad();
  const next = rows.filter((p) => p.id !== id);
  if (next.length === rows.length) return false;
  await filePersist(next);
  return true;
}
