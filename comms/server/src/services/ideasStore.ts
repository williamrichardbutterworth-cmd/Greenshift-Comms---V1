import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Persistent, swappable feedback store. In production (Vercel) it uses Supabase
// Postgres; with no Supabase env configured it falls back to a local JSON file,
// so `npm run dev` works with zero setup. Same interface either way.

export type IdeaStatus = 'new' | 'considering' | 'planned' | 'done';
export const IDEA_STATUSES: IdeaStatus[] = ['new', 'considering', 'planned', 'done'];
export const IDEA_CATEGORIES = ['Dashboard', 'Daily brief', 'Reports', 'Data sources', 'UX / design', 'Other'];

export interface Idea {
  id: string;
  author: string;
  title: string;
  details: string;
  reasoning: string;
  category: string;
  status: IdeaStatus;
  votes: number;
  createdAt: string;
}

export interface NewIdea {
  author?: string;
  title?: string;
  details?: string;
  reasoning?: string;
  category?: string;
}

const clamp = (s: unknown, max: number, fallback = ''): string => {
  const v = typeof s === 'string' ? s.trim() : '';
  return (v || fallback).slice(0, max);
};

function normalise(input: NewIdea): Omit<Idea, 'id' | 'createdAt'> {
  const title = clamp(input.title, 200);
  if (!title) throw new Error('An idea title is required.');
  return {
    author: clamp(input.author, 80, 'Anonymous'),
    title,
    details: clamp(input.details, 4000),
    reasoning: clamp(input.reasoning, 4000),
    category: IDEA_CATEGORIES.includes(String(input.category)) ? String(input.category) : 'Other',
    status: 'new',
    votes: 0,
  };
}

const sortIdeas = (ideas: Idea[]): Idea[] =>
  [...ideas].sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt));

// ───────────────────────── Supabase backing ─────────────────────────

type Row = {
  id: string; author: string; title: string; details: string; reasoning: string;
  category: string; status: IdeaStatus; votes: number; created_at: string;
};
const rowToIdea = (r: Row): Idea => ({
  id: r.id, author: r.author, title: r.title, details: r.details, reasoning: r.reasoning,
  category: r.category, status: r.status, votes: r.votes, createdAt: r.created_at,
});

// ───────────────────────── File backing (local fallback) ─────────────────────────

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'ideas.json');
let fileCache: Idea[] | null = null;

async function fileLoad(): Promise<Idea[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed) ? (parsed as Idea[]) : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function filePersist(ideas: Idea[]): Promise<void> {
  fileCache = ideas;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(ideas, null, 2), 'utf8');
  await rename(tmp, FILE);
}

// ───────────────────────── Public API ─────────────────────────

export async function listIdeas(): Promise<Idea[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb
      .from('ideas')
      .select('*')
      .order('votes', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToIdea);
  }
  return sortIdeas(await fileLoad());
}

export async function addIdea(input: NewIdea): Promise<Idea> {
  const fields = normalise(input);
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('ideas').insert(fields).select().single();
    if (error) throw new Error(error.message);
    return rowToIdea(data as Row);
  }
  const idea: Idea = { id: randomUUID(), createdAt: new Date().toISOString(), ...fields };
  await filePersist([idea, ...(await fileLoad())]);
  return idea;
}

export async function voteIdea(id: string): Promise<Idea | null> {
  const sb = getSupabase();
  if (sb) {
    const { data: cur, error: e1 } = await sb.from('ideas').select('votes').eq('id', id).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!cur) return null;
    const { data, error } = await sb.from('ideas').update({ votes: cur.votes + 1 }).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return rowToIdea(data as Row);
  }
  const ideas = await fileLoad();
  const idea = ideas.find((i) => i.id === id);
  if (!idea) return null;
  idea.votes += 1;
  await filePersist(ideas);
  return idea;
}

export async function setIdeaStatus(id: string, status: IdeaStatus): Promise<Idea | null> {
  if (!IDEA_STATUSES.includes(status)) throw new Error('Invalid status.');
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('ideas').update({ status }).eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToIdea(data as Row) : null;
  }
  const ideas = await fileLoad();
  const idea = ideas.find((i) => i.id === id);
  if (!idea) return null;
  idea.status = status;
  await filePersist(ideas);
  return idea;
}

export async function deleteIdea(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('ideas').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const ideas = await fileLoad();
  const next = ideas.filter((i) => i.id !== id);
  if (next.length === ideas.length) return false;
  await filePersist(next);
  return true;
}
