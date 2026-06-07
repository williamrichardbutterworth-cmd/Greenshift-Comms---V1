import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Reusable client profiles (§8B Batch 2). Same dual Supabase/file-fallback
// pattern as ideasStore — `inputs` is the opaque ReportInputs shape.

export interface ClientProfile {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  createdAt: string;
}
export interface NewClientProfile {
  name?: string;
  inputs?: Record<string, unknown>;
}

const clampName = (s: unknown, inputs?: Record<string, unknown>): string => {
  const v = typeof s === 'string' ? s.trim() : '';
  const company = inputs && typeof inputs.companyName === 'string' ? inputs.companyName.trim() : '';
  return (v || company || 'Untitled client').slice(0, 200);
};

type Row = { id: string; name: string; inputs: Record<string, unknown>; created_at: string };
const rowToProfile = (r: Row): ClientProfile => ({ id: r.id, name: r.name, inputs: r.inputs ?? {}, createdAt: r.created_at });

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'client-profiles.json');
let fileCache: ClientProfile[] | null = null;

async function fileLoad(): Promise<ClientProfile[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed) ? (parsed as ClientProfile[]) : [];
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
const byNewest = (a: ClientProfile, b: ClientProfile) => b.createdAt.localeCompare(a.createdAt);

export async function listClientProfiles(): Promise<ClientProfile[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToProfile);
  }
  return (await fileLoad()).slice().sort(byNewest);
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
  const fields = { name: clampName(input.name, input.inputs), inputs: input.inputs ?? {} };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').insert(fields).select().single();
    if (error) throw new Error(error.message);
    return rowToProfile(data as Row);
  }
  const profile: ClientProfile = { id: randomUUID(), createdAt: new Date().toISOString(), ...fields };
  await filePersist([profile, ...(await fileLoad())]);
  return profile;
}

export async function updateClientProfile(id: string, input: NewClientProfile): Promise<ClientProfile | null> {
  const current = await getClientProfile(id);
  if (!current) return null;
  const next: ClientProfile = {
    ...current,
    name: input.name !== undefined || input.inputs !== undefined ? clampName(input.name ?? current.name, input.inputs ?? current.inputs) : current.name,
    inputs: input.inputs !== undefined ? input.inputs : current.inputs,
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('client_profiles').update({ name: next.name, inputs: next.inputs }).eq('id', id).select().maybeSingle();
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
