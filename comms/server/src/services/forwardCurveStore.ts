import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupabase } from '../lib/supabase';

// Forward-curve snapshots — the UK power baseload + NBP gas seasonal price
// curves taken from the morning market report (operator pastes/uploads it, the
// AI extracts the tables). Each dated snapshot proves whether the market is in
// backwardation (further-out seasons cheaper), which is the core "procure now"
// argument. Same dual Supabase/file-fallback pattern as the rest of the app.

export type Commodity = 'power' | 'gas';
const COMMODITIES: Commodity[] = ['power', 'gas'];

export interface CurveLeg {
  /** Contract label, e.g. "DA", "Jul-26", "Q3-26", "Win 26", "Sum 27". */
  label: string;
  /** Most recent settlement column (the report's "as of" date). */
  latest: number | null;
  /** Previous settlement column (one report day earlier). */
  prev: number | null;
  /** Current live offer/price column (the "(*)" column). */
  current: number | null;
}

export interface CommodityCurve {
  commodity: Commodity;
  unit: string; // '£/MWh' for power, 'p/therm' for gas
  legs: CurveLeg[];
}

export interface ForwardCurveSnapshot {
  id: string;
  /** The report's most-recent settlement date (YYYY-MM-DD). */
  asOfDate: string;
  source: string;
  note?: string;
  curves: CommodityCurve[];
  createdAt: string;
}

export interface NewForwardCurve {
  asOfDate?: string;
  source?: string;
  note?: string;
  curves: CommodityCurve[];
}

const MAX_SNAPSHOTS = 400;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const ymd = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

export function coerceCurves(raw: unknown): CommodityCurve[] {
  if (!Array.isArray(raw)) return [];
  const out: CommodityCurve[] = [];
  const seen = new Set<Commodity>();
  for (const c of raw) {
    const cur = c as Record<string, unknown>;
    const commodity = cur.commodity as Commodity;
    if (!COMMODITIES.includes(commodity) || seen.has(commodity)) continue; // one curve per commodity
    const legs: CurveLeg[] = Array.isArray(cur.legs)
      ? cur.legs
          .map((l) => {
            const leg = l as Record<string, unknown>;
            const label = typeof leg.label === 'string' ? leg.label.trim().slice(0, 24) : '';
            return label ? { label, latest: num(leg.latest), prev: num(leg.prev), current: num(leg.current) } : null;
          })
          .filter((l): l is CurveLeg => l !== null)
          .slice(0, 40)
      : [];
    if (legs.length) {
      out.push({
        commodity,
        unit: typeof cur.unit === 'string' && cur.unit.trim() ? cur.unit.trim().slice(0, 16) : (commodity === 'power' ? '£/MWh' : 'p/therm'),
        legs,
      });
    }
  }
  return out;
}

function coerceSnapshot(p: Partial<ForwardCurveSnapshot> & { id: string; createdAt: string }): ForwardCurveSnapshot {
  return {
    id: p.id,
    asOfDate: ymd(p.asOfDate) || p.createdAt.slice(0, 10),
    source: typeof p.source === 'string' && p.source.trim() ? p.source.trim().slice(0, 120) : 'Market report',
    note: typeof p.note === 'string' ? p.note.slice(0, 600) : undefined,
    curves: coerceCurves(p.curves),
    createdAt: p.createdAt,
  };
}

// ── Supabase row mapping ──
type Row = { id: string; as_of_date: string | null; source: string | null; note: string | null; curves: CommodityCurve[] | null; created_at: string };
const rowToSnap = (r: Row): ForwardCurveSnapshot => coerceSnapshot({
  id: r.id, asOfDate: r.as_of_date ?? undefined, source: r.source ?? undefined, note: r.note ?? undefined,
  curves: r.curves ?? [], createdAt: r.created_at,
});
const snapToRow = (s: ForwardCurveSnapshot) => ({
  id: s.id, as_of_date: s.asOfDate, source: s.source, note: s.note ?? null, curves: s.curves, created_at: s.createdAt,
});

const DATA_DIR = fileURLToPath(new URL('../../data', import.meta.url));
const FILE = join(DATA_DIR, 'forward-curves.json');
let fileCache: ForwardCurveSnapshot[] | null = null;

async function fileLoad(): Promise<ForwardCurveSnapshot[]> {
  if (fileCache) return fileCache;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    fileCache = Array.isArray(parsed) ? (parsed as (Partial<ForwardCurveSnapshot> & { id: string; createdAt: string })[]).map(coerceSnapshot) : [];
  } catch {
    fileCache = [];
  }
  return fileCache;
}
async function filePersist(rows: ForwardCurveSnapshot[]): Promise<void> {
  fileCache = rows;
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8');
  await rename(tmp, FILE);
}
// Newest first — by report date, then by capture time as a tie-breaker.
const byRecency = (a: ForwardCurveSnapshot, b: ForwardCurveSnapshot) =>
  (b.asOfDate || '').localeCompare(a.asOfDate || '') || (b.createdAt || '').localeCompare(a.createdAt || '');

export async function listForwardCurves(): Promise<ForwardCurveSnapshot[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from('forward_curves').select('*').order('as_of_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map(rowToSnap);
  }
  return (await fileLoad()).slice().sort(byRecency);
}

export async function getLatestForwardCurve(): Promise<ForwardCurveSnapshot | null> {
  const all = await listForwardCurves();
  return all[0] ?? null;
}

export async function saveForwardCurve(input: NewForwardCurve): Promise<ForwardCurveSnapshot> {
  const now = new Date().toISOString();
  const snap = coerceSnapshot({
    id: randomUUID(), asOfDate: input.asOfDate, source: input.source, note: input.note, curves: input.curves, createdAt: now,
  });
  if (!snap.curves.length) throw new Error('No curve data to save.');
  const sb = getSupabase();
  if (sb) {
    // One snapshot per report date — but insert FIRST, then remove the older
    // same-day rows, so a failed write can never lose the existing snapshot
    // (delete-then-insert would leave nothing if the insert errored).
    const { data, error } = await sb.from('forward_curves').insert(snapToRow(snap)).select().single();
    if (error) throw new Error(error.message);
    await sb.from('forward_curves').delete().eq('as_of_date', snap.asOfDate).neq('id', snap.id);
    return rowToSnap(data as Row);
  }
  const rows = (await fileLoad()).filter((r) => r.asOfDate !== snap.asOfDate);
  await filePersist([snap, ...rows].sort(byRecency).slice(0, MAX_SNAPSHOTS));
  return snap;
}

export async function removeForwardCurve(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (sb) {
    const { error, count } = await sb.from('forward_curves').delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }
  const rows = await fileLoad();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  await filePersist(next);
  return true;
}

// A daily "front of curve" series built purely from our own saved snapshots —
// a legal, self-owned stand-in for a paid price-history feed. Uses each
// snapshot's day-ahead (DA) leg, or the first leg if DA isn't present.
export interface ForwardTrendPoint { t: string; v: number }
export async function getForwardTrend(commodity: Commodity): Promise<{ commodity: Commodity; unit: string; points: ForwardTrendPoint[] }> {
  const all = await listForwardCurves();
  const points: ForwardTrendPoint[] = [];
  let unit = commodity === 'power' ? '£/MWh' : 'p/therm';
  for (const snap of all) {
    const curve = snap.curves.find((c) => c.commodity === commodity);
    if (!curve) continue;
    unit = curve.unit || unit;
    const front = curve.legs.find((l) => /^da$/i.test(l.label)) ?? curve.legs[0];
    const v = front?.current ?? front?.latest ?? null;
    if (v != null && snap.asOfDate) points.push({ t: snap.asOfDate, v });
  }
  // chronological, de-duplicated by date (keep the most recent capture per day,
  // which is the first occurrence since `all` is newest-first)
  const seen = new Set<string>();
  const deduped = points.filter((p) => (seen.has(p.t) ? false : (seen.add(p.t), true)));
  deduped.sort((a, b) => a.t.localeCompare(b.t));
  return { commodity, unit, points: deduped };
}
