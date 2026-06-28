import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Persistent, swappable store for saved report projects. Same dual-path design as
// ideasStore: Supabase Postgres in production, a local JSON file when no Supabase
// env is set (so `npm run dev` needs zero setup). The document (`doc`), context
// tray (`context`) and version history are opaque JSON to the server — it never
// parses the TipTap document, it just stores and returns it.

const MAX_VERSIONS = 20;
const DOC_BYTES_LIMIT = 1.5 * 1024 * 1024; // soft guard under Fastify's 2MB bodyLimit

// `inputs` mirrors the frontend ReportInputs; doc/context/versions are opaque.
export interface ReportVersion {
  at: string;
  label: string;
  doc: unknown;
  inputs: Record<string, unknown>;
}
export interface ReportProject {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  doc: unknown;
  context: unknown[];
  versions: ReportVersion[];
  createdAt: string;
  updatedAt: string;
}
// The projects panel lists summaries only (no heavy doc/versions payload).
export interface ReportProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Which report-engine template this project uses (absent for legacy projects). */
  templateId?: string;
}

export interface NewProject {
  name?: string;
  inputs?: Record<string, unknown>;
  doc?: unknown;
  context?: unknown[];
}
export interface ProjectPatch {
  name?: string;
  inputs?: Record<string, unknown>;
  doc?: unknown;
  context?: unknown[];
  saveVersion?: boolean;
  versionLabel?: string;
}

const EMPTY_DOC = { type: 'doc', content: [] };

const clampName = (s: unknown): string => {
  const v = typeof s === 'string' ? s.trim() : '';
  return (v || 'Untitled report').slice(0, 200);
};

// Reject absurdly large payloads early with a clear message (defence in depth —
// Fastify's bodyLimit already caps the request at 2MB).
function guardSize(value: unknown, field: string): void {
  if (value === undefined) return;
  if (JSON.stringify(value).length > DOC_BYTES_LIMIT) {
    throw new Error(`Report ${field} is too large to save.`);
  }
}

// ───────────────────────── Supabase backing ─────────────────────────

type Row = {
  id: string; name: string; inputs: Record<string, unknown>; doc: unknown;
  context: unknown[]; versions: ReportVersion[]; created_at: string; updated_at: string;
};
const rowToProject = (r: Row): ReportProject => ({
  id: r.id, name: r.name, inputs: r.inputs ?? {}, doc: r.doc ?? EMPTY_DOC,
  context: r.context ?? [], versions: r.versions ?? [], createdAt: r.created_at, updatedAt: r.updated_at,
});
const templateIdOf = (inputs: Record<string, unknown> | undefined): string | undefined => {
  const t = (inputs ?? {})['templateId'];
  return typeof t === 'string' ? t : undefined;
};
const rowToSummary = (r: Pick<Row, 'id' | 'name' | 'inputs' | 'created_at' | 'updated_at'>): ReportProjectSummary => ({
  id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, templateId: templateIdOf(r.inputs),
});

// ───────────────────────── File backing (local fallback) ─────────────────────────

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'report-projects.json');
let fileCache: ReportProject[] | null = null;

async function fileLoad(): Promise<ReportProject[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed) ? (parsed as ReportProject[]) : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function filePersist(projects: ReportProject[]): Promise<void> {
  fileCache = projects;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(projects, null, 2), 'utf8');
  await rename(tmp, FILE);
}
const byUpdatedDesc = (a: ReportProject, b: ReportProject) => b.updatedAt.localeCompare(a.updatedAt);

// Append a capped version snapshot of the state being saved.
function withVersion(project: ReportProject, label: string): ReportVersion[] {
  const entry: ReportVersion = {
    at: new Date().toISOString(),
    label: clampName(label) === 'Untitled report' ? 'Saved version' : clampName(label),
    doc: project.doc,
    inputs: project.inputs,
  };
  return [...project.versions, entry].slice(-MAX_VERSIONS);
}

// ───────────────────────── Public API ─────────────────────────

export async function listProjects(): Promise<ReportProjectSummary[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('report_projects')
      .select('id, name, inputs, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToSummary);
  }
  return (await fileLoad()).slice().sort(byUpdatedDesc).map((p) => ({
    id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, templateId: templateIdOf(p.inputs),
  }));
}

export async function getProject(id: string): Promise<ReportProject | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('report_projects').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToProject(data as Row) : null;
  }
  return (await fileLoad()).find((p) => p.id === id) ?? null;
}

export async function createProject(input: NewProject): Promise<ReportProject> {
  guardSize(input.doc, 'document');
  guardSize(input.context, 'context');
  const fields = {
    name: clampName(input.name),
    inputs: input.inputs ?? {},
    doc: input.doc ?? EMPTY_DOC,
    context: input.context ?? [],
    versions: [] as ReportVersion[],
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('report_projects').insert(fields).select().single();
    if (error) throw new Error(error.message);
    return rowToProject(data as Row);
  }
  const now = new Date().toISOString();
  const project: ReportProject = { id: randomUUID(), createdAt: now, updatedAt: now, ...fields };
  await filePersist([project, ...(await fileLoad())]);
  return project;
}

export async function updateProject(id: string, patch: ProjectPatch): Promise<ReportProject | null> {
  guardSize(patch.doc, 'document');
  guardSize(patch.context, 'context');
  const current = await getProject(id);
  if (!current) return null;

  const next: ReportProject = {
    ...current,
    name: patch.name !== undefined ? clampName(patch.name) : current.name,
    inputs: patch.inputs !== undefined ? patch.inputs : current.inputs,
    doc: patch.doc !== undefined ? patch.doc : current.doc,
    context: patch.context !== undefined ? patch.context : current.context,
    updatedAt: new Date().toISOString(),
  };
  if (patch.saveVersion) next.versions = withVersion(next, patch.versionLabel ?? 'Saved version');

  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('report_projects')
      .update({
        name: next.name, inputs: next.inputs, doc: next.doc, context: next.context,
        versions: next.versions, updated_at: next.updatedAt,
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToProject(data as Row) : null;
  }
  const projects = await fileLoad();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  projects[idx] = next;
  await filePersist(projects);
  return next;
}

export async function removeProject(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('report_projects').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const projects = await fileLoad();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return false;
  await filePersist(next);
  return true;
}
