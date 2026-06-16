import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// User-definable document templates. A template is a reusable "what document to
// build" definition: a channel (A4 document vs email body), an overall steer,
// and an ordered list of sections the model fills. Same dual Supabase/file
// fallback pattern as the other stores; built-ins are seeded on first read.

export interface TemplateSection {
  kind: 'text' | 'embed';
  heading?: string;
  /** For text sections: what the model should write here. */
  guidance?: string;
  /** For embed sections: marketSnapshot | generationMap | selectedNews | chart:gas:12m | customChart:<id> */
  ref?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  channel: 'document' | 'email';
  /** Optional lucide icon name the web maps to a glyph. */
  icon?: string;
  /** Overall steer: purpose, tone, audience. */
  guidance: string;
  sections: TemplateSection[];
  builtin: boolean;
  createdAt: string;
}

export interface NewTemplate {
  name?: string;
  description?: string;
  channel?: 'document' | 'email';
  icon?: string;
  guidance?: string;
  sections?: TemplateSection[];
}

// ── Built-in templates (seeded on first read into an empty store) ──
const seedTemplates = (): DocumentTemplate[] => {
  const now = new Date().toISOString();
  const mk = (t: Omit<DocumentTemplate, 'id' | 'builtin' | 'createdAt'> & { id: string }): DocumentTemplate =>
    ({ builtin: true, createdAt: now, ...t });
  return [
    mk({
      id: 'builtin-market-report',
      name: 'Market & procurement report',
      description: 'The full client-ready report: market context, evidence, outlook and a tailored recommendation.',
      channel: 'document',
      icon: 'FileText',
      guidance: 'A polished, thorough market & procurement report for a UK business energy client. Professional and confident.',
      sections: [
        { kind: 'text', heading: 'Executive summary', guidance: 'Who this is for and the single headline takeaway for their energy procurement.' },
        { kind: 'text', heading: 'Market context', guidance: 'Where gas & power are and what is driving them, grounded in the market data.' },
        { kind: 'embed', heading: 'Market data', ref: 'marketSnapshot' },
        { kind: 'text', heading: 'Outlook', guidance: 'A balanced near-term outlook — no over-promising.' },
        { kind: 'embed', heading: 'Supporting evidence', ref: 'selectedNews' },
        { kind: 'text', heading: 'Our recommendation', guidance: 'What Green Shift recommends and why, tailored to this client (name their supplier, contract end and consumption where given).' },
      ],
    }),
    mk({
      id: 'builtin-post-call-followup',
      name: 'Post-call follow-up email',
      description: '“Thank you for today’s call…” — a warm recap and clear next steps to send straight after a call.',
      channel: 'email',
      icon: 'Mail',
      guidance: 'A warm, concise follow-up email sent by the Green Shift agent straight after a sales/discovery call. Written in the first person to the named contact. Reference what was discussed (from the agent’s notes / call points), keep it human and brief, and finish with clear next steps. Plain text — no headings, no markdown, no bullet-dumping.',
      sections: [
        { kind: 'text', guidance: 'Greeting addressing the contact by first name, and a genuine thank-you for their time on the call today.' },
        { kind: 'text', guidance: 'Briefly recap what was discussed and their situation/goals, drawing on the agent’s notes and the client details — show you listened.' },
        { kind: 'text', guidance: 'Share one or two relevant market points that matter for their decision, in plain language (no figure-dumping).' },
        { kind: 'text', guidance: 'Clear, specific next steps and an offer to help, then a warm professional sign-off from the Green Shift agent.' },
      ],
    }),
    mk({
      id: 'builtin-procure-ahead',
      name: 'Procure-ahead recommendation',
      description: 'Proves, with the forward curve, that securing energy ahead is cheaper than waiting — built around the backwardation read.',
      channel: 'document',
      icon: 'TrendingDown',
      guidance: 'A concise, evidence-led report showing this client that buying their energy forward now is cheaper and lower-risk than waiting, using the UK power baseload + NBP gas forward curves. Confident and specific, but honest about risk. Anchor the argument in the forward-curve figures and their contract timing.',
      sections: [
        { kind: 'text', heading: 'The opportunity', guidance: 'In two or three sentences: why procurement timing matters for this client right now, given their contract end and consumption.' },
        { kind: 'text', heading: 'What the forward market is telling us', guidance: 'Explain, in plain English, that the forward curve is in backwardation — later delivery is cheaper than the front — so fixing ahead locks in lower prices. Do not restate every figure; the curve block below shows them.' },
        { kind: 'embed', heading: 'UK forward curve', ref: 'forwardCurve' },
        { kind: 'text', heading: 'Our recommendation', guidance: 'A clear fix-ahead recommendation tailored to this client’s contract end and risk appetite, with the headline saving versus waiting, and an honest note on risk.' },
        { kind: 'text', heading: 'Next steps', guidance: 'What happens next and how Green Shift will help them secure it (e.g. LOA, gather quotes).' },
      ],
    }),
    mk({
      id: 'builtin-renewal-recommendation',
      name: 'Contract renewal recommendation',
      description: 'A focused fix-or-wait recommendation driven by the client’s contract end date and the current market.',
      channel: 'document',
      icon: 'CalendarClock',
      guidance: 'A focused recommendation on whether the client should fix now or wait on their energy contract, given their contract end date, consumption and the current market. Decisive but honest about risk.',
      sections: [
        { kind: 'text', heading: 'Your situation', guidance: 'Their company, current supplier, contract end date and consumption — the facts that frame the decision.' },
        { kind: 'text', heading: 'Market backdrop', guidance: 'Current gas & power levels and the trend, grounded in the data.' },
        { kind: 'embed', heading: 'Market data', ref: 'marketSnapshot' },
        { kind: 'text', heading: 'Our recommendation', guidance: 'Fix now vs wait, with clear reasoning tied to their contract timing and risk appetite.' },
        { kind: 'text', heading: 'Next steps', guidance: 'What happens next and how Green Shift will help them act on it.' },
      ],
    }),
  ];
};

// ── Validation / coercion of a (possibly user-supplied) template ──
const VALID_REF = /^(marketSnapshot|generationMap|forwardCurve|selectedNews|chart:(brent|gas|power):(3m|6m|12m)|customChart:.+)$/;

function coerceSections(raw: unknown): TemplateSection[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateSection[] = [];
  for (const s of raw.slice(0, 20)) {
    const sec = s as Record<string, unknown>;
    const kind = sec.kind === 'embed' ? 'embed' : 'text';
    const heading = typeof sec.heading === 'string' ? sec.heading.slice(0, 160) : undefined;
    if (kind === 'embed') {
      const ref = typeof sec.ref === 'string' && VALID_REF.test(sec.ref) ? sec.ref : '';
      if (ref) out.push({ kind: 'embed', heading, ref });
    } else {
      out.push({ kind: 'text', heading, guidance: typeof sec.guidance === 'string' ? sec.guidance.slice(0, 600) : '' });
    }
  }
  return out;
}

function coerce(input: NewTemplate): Omit<DocumentTemplate, 'id' | 'builtin' | 'createdAt'> {
  const channel = input.channel === 'email' ? 'email' : 'document';
  let sections = coerceSections(input.sections);
  // Emails flow as one prose message — data-block embeds don't render in the
  // copied/downloaded text, so drop them from email templates.
  if (channel === 'email') sections = sections.filter((s) => s.kind === 'text');
  return {
    name: (typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Untitled template').slice(0, 200),
    description: (typeof input.description === 'string' ? input.description : '').slice(0, 500),
    channel,
    icon: typeof input.icon === 'string' ? input.icon.slice(0, 40) : undefined,
    guidance: (typeof input.guidance === 'string' ? input.guidance : '').slice(0, 2000),
    sections,
  };
}

type Row = { id: string; name: string; description: string; channel: string; icon: string | null; guidance: string; sections: TemplateSection[]; builtin: boolean; created_at: string };
const rowToTemplate = (r: Row): DocumentTemplate => ({
  id: r.id, name: r.name, description: r.description, channel: r.channel === 'email' ? 'email' : 'document',
  icon: r.icon ?? undefined, guidance: r.guidance, sections: r.sections ?? [], builtin: !!r.builtin, createdAt: r.created_at,
});
const templateToRow = (t: DocumentTemplate) => ({
  id: t.id, name: t.name, description: t.description, channel: t.channel, icon: t.icon ?? null,
  guidance: t.guidance, sections: t.sections, builtin: t.builtin, created_at: t.createdAt,
});

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'document-templates.json');
let fileCache: DocumentTemplate[] | null = null;

async function filePersist(rows: DocumentTemplate[]): Promise<void> {
  fileCache = rows;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, FILE);
}
// Backfill any built-in templates added in a later release that an existing
// store doesn't have yet (keyed by their fixed builtin-* ids).
function mergeBuiltins(rows: DocumentTemplate[]): DocumentTemplate[] {
  const have = new Set(rows.map((t) => t.id));
  const missing = seedTemplates().filter((t) => !have.has(t.id));
  return missing.length ? [...rows, ...missing] : rows;
}

async function fileLoad(): Promise<DocumentTemplate[]> {
  if (fileCache) return fileCache;
  let rows: DocumentTemplate[];
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    rows = Array.isArray(parsed) && parsed.length ? (parsed as DocumentTemplate[]) : seedTemplates();
  } catch {
    rows = seedTemplates();
  }
  fileCache = mergeBuiltins(rows);
  if (fileCache.length) await filePersist(fileCache).catch(() => {});
  return fileCache;
}

async function ensureSeeded(sb: ReturnType<typeof getSupabase>): Promise<void> {
  if (!sb) return;
  // Insert any builtin that isn't present yet — seeds an empty table AND
  // backfills builtins added in a later release. Idempotent: upsert/ignore on
  // the fixed builtin-* ids avoids a duplicate-key 500 under a cold-start race.
  const { data, error } = await sb.from('document_templates').select('id');
  if (error) throw new Error(error.message);
  const have = new Set((data ?? []).map((r) => (r as { id: string }).id));
  const missing = seedTemplates().filter((t) => !have.has(t.id));
  if (missing.length) {
    const { error: insErr } = await sb
      .from('document_templates')
      .upsert(missing.map(templateToRow), { onConflict: 'id', ignoreDuplicates: true });
    if (insErr) throw new Error(insErr.message);
  }
}

const byBuiltinThenNewest = (a: DocumentTemplate, b: DocumentTemplate) =>
  Number(b.builtin) - Number(a.builtin) || b.createdAt.localeCompare(a.createdAt);

export async function listTemplates(): Promise<DocumentTemplate[]> {
  const sb = getSupabase();
  if (sb) {
    await ensureSeeded(sb);
    const { data, error } = await sb.from('document_templates').select('*');
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToTemplate).sort(byBuiltinThenNewest);
  }
  return (await fileLoad()).slice().sort(byBuiltinThenNewest);
}

export async function getTemplate(id: string): Promise<DocumentTemplate | null> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('document_templates').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToTemplate(data as Row) : null;
  }
  return (await fileLoad()).find((t) => t.id === id) ?? null;
}

export async function createTemplate(input: NewTemplate): Promise<DocumentTemplate> {
  const fields = coerce(input);
  const template: DocumentTemplate = { id: randomUUID(), builtin: false, createdAt: new Date().toISOString(), ...fields };
  const sb = getSupabase();
  if (sb) {
    await ensureSeeded(sb);
    const { data, error } = await sb.from('document_templates').insert(templateToRow(template)).select().single();
    if (error) throw new Error(error.message);
    return rowToTemplate(data as Row);
  }
  await filePersist([...(await fileLoad()), template]);
  return template;
}

export async function updateTemplate(id: string, input: NewTemplate): Promise<DocumentTemplate | null> {
  const current = await getTemplate(id);
  if (!current) return null;
  const fields = coerce({ ...current, ...input });
  const next: DocumentTemplate = { ...current, ...fields };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('document_templates')
      .update({ name: next.name, description: next.description, channel: next.channel, icon: next.icon ?? null, guidance: next.guidance, sections: next.sections })
      .eq('id', id).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToTemplate(data as Row) : null;
  }
  const rows = await fileLoad();
  const idx = rows.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  rows[idx] = next;
  await filePersist(rows);
  return next;
}

export async function removeTemplate(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('document_templates').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad();
  const next = rows.filter((t) => t.id !== id);
  if (next.length === rows.length) return false;
  await filePersist(next);
  return true;
}
