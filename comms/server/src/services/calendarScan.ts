import { createHash } from 'node:crypto';
import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { calendarScanPrompt } from './prompts';
import { listFiles } from './fileStore';
import type { ClientProfile, ClientActivity } from './clientProfilesStore';
import type { CalendarKind, CalendarConfidence, DetectedEvent } from './calendarStore';

// Detection engine: mines a client's timeline for forward commitments and turns
// them into provenance-backed calendar events. Mirrors the never-throw contract
// of the other extractors (clientIntake/billAnalysis): it degrades to
// provider:'none' (no key) or provider:'error' (a failure) and NEVER 500s.
//
// Grounding is enforced in code, not trusted to the model: an event survives only
// if (a) the model tagged it a real future "commitment", (b) its quoted source
// actually appears verbatim in the segment it claims (anti-hallucination), (c) its
// date parses, and (d) the date isn't before the moment it was logged (a deadline
// can't be owed in the past). Idempotency comes from a deterministic dedupeKey
// built from immutable provenance — client + kind + source activity + due-date —
// so re-scanning updates the same row instead of duplicating it.

const MINEABLE = new Set<ClientActivity['type']>(['transcript', 'note', 'email-sent', 'email-received']);
const SCAN_KINDS = new Set<CalendarKind>(['callback', 'deadline', 'our-action']);
// Bound the prompt: the most recent N mineable entries, each detail trimmed.
const MAX_SEGMENTS = 30;
const SEGMENT_CHARS = 1500;
// Activities whose verbatim transcript survives as a file (meta.transcriptFileId)
// are mined from the RAW text, not the summary bullets. The slice matches the
// head window the log-call extraction saw (prompts.headTail: 10000+4000), so the
// two grounding moments quote from the same text and key identically; hydrate
// only the newest few (older ones were already mined in full when logged).
const RAW_SEGMENT_CHARS = 14000;
const MAX_RAW_SEGMENTS = 3;

export interface CalendarScanResult {
  events: DetectedEvent[];
  provider: string;
  error?: string;
  /** Visibility into the drop gates so a silently-empty scan is distinguishable from a real one. */
  stats?: { segments: number; raw: number; kept: number; truncated: number };
}

export interface RawEvent {
  ref?: number;
  kind?: string;
  title?: string;
  dueISO?: string;
  dueText?: string;
  allDay?: boolean;
  source?: string;
  nature?: string;
  confidence?: string;
}

// Whitespace/punctuation-insensitive containment — the model is told to quote
// verbatim, but real copies vary in spacing/curly-quotes, so we normalise before
// checking the quote is genuinely present in the cited segment.
const norm = (s: string): string => s.toLowerCase().replace(/[‘’“”"']/g, '').replace(/\s+/g, ' ').trim();

// The calendar day (Europe/London) of an ISO instant — used for the dedupe key so
// the same commitment keys identically regardless of clock time / BST boundary.
function londonDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const coerceConf = (v: unknown): CalendarConfidence => (v === 'high' || v === 'low' ? v : v === 'medium' ? 'medium' : 'low');

// The provenance/date gates, shared by the timeline scan and the log-call unified
// extraction. An event survives only if: it's a real future commitment of a known
// kind, its date parses and isn't before the moment it was logged, and its quoted
// source (and date phrase) genuinely appear verbatim in the haystack it claims —
// so a real sentence can't anchor a fabricated date.
export function groundEvent(
  clientProfileId: string,
  seg: { id: string; at: string; haystack: string },
  e: RawEvent,
): DetectedEvent | null {
  if (e.nature !== 'commitment') return null;             // hypothetical/past/negated/third-party
  const kind = e.kind as CalendarKind;
  if (!SCAN_KINDS.has(kind)) return null;
  const due = typeof e.dueISO === 'string' ? e.dueISO.trim() : '';
  const t = Date.parse(due);
  if (!Number.isFinite(t)) return null;                   // unparseable date
  const start = new Date(t).toISOString();
  // A commitment can't fall before it was logged (drop stale/past resolutions).
  // Only apply the gate when the activity timestamp itself parses cleanly —
  // otherwise a malformed `at` would compare arbitrary substrings.
  const segMs = Date.parse(seg.at);
  if (Number.isFinite(segMs) && londonDay(start) < londonDay(new Date(segMs).toISOString())) return null;

  const source = typeof e.source === 'string' ? e.source.trim() : '';
  const dueText = typeof e.dueText === 'string' ? e.dueText.trim() : '';
  const nHay = norm(seg.haystack);
  if (!source || norm(source).length < 12 || !nHay.includes(norm(source))) return null;
  if (dueText && !nHay.includes(norm(dueText))) return null; // date phrase must be grounded too

  // Idempotency key from immutable provenance + the verbatim source sentence
  // (NOT the resolved date): a re-scan that resolves the same commitment to a
  // slightly different date keys identically and UPDATES in place, while two
  // distinct commitments in one activity (different sentences) stay separate.
  const dedupeKey = createHash('sha1').update(`${clientProfileId}|${kind}|${seg.id}|${norm(source)}`).digest('hex');
  return {
    dedupeKey,
    title: (typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Reminder').slice(0, 200),
    start,
    allDay: e.allDay !== false,
    kind,
    clientProfileId,
    source: source.slice(0, 600),
    sourceActivityId: seg.id,
    confidence: coerceConf(e.confidence),
  };
}

/** Ground a whole raw list against ONE segment, collapsing exact duplicates. */
export function groundEvents(
  clientProfileId: string,
  seg: { id: string; at: string; haystack: string },
  list: RawEvent[],
): DetectedEvent[] {
  const out: DetectedEvent[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const d = groundEvent(clientProfileId, seg, e);
    if (!d || seen.has(d.dedupeKey)) continue;
    seen.add(d.dedupeKey);
    out.push(d);
  }
  return out;
}

export async function scanClientCalendar(profile: ClientProfile): Promise<CalendarScanResult> {
  if (!aiConfigured()) return { events: [], provider: 'none' };

  // Build the segment list (newest-first array, but indexed so the model can ref
  // back). Any activity carrying a verbatim transcript file is mineable regardless
  // of type — a pasted bill logs as 'file' but its raw text can hold commitments.
  const segments = profile.activities
    .filter((a) => (MINEABLE.has(a.type) || typeof a.meta?.transcriptFileId === 'string') && (a.detail || a.title))
    .slice(0, MAX_SEGMENTS);
  if (!segments.length) return { events: [], provider: 'none', stats: { segments: 0, raw: 0, kept: 0, truncated: 0 } };

  // Hydrate the verbatim transcript text for activities that carry one — the raw
  // call, not the summary bullets, is what commitments are quoted from.
  const rawTextByFileId = new Map<string, string>();
  if (segments.some((a) => typeof a.meta?.transcriptFileId === 'string')) {
    try {
      const files = await listFiles({ clientProfileId: profile.id });
      for (const f of files) if (f.extractedText?.trim()) rawTextByFileId.set(f.id, f.extractedText);
    } catch { /* fall back to the stored bullets */ }
  }
  // Slice each BODY (not the prefixed line) so the char caps mean what they say
  // regardless of prefix length, and count truncations so a silently-shortened
  // scan is distinguishable from a genuinely empty one. The gates below check the
  // quote against the SAME body string the model saw.
  let truncated = 0;
  let rawUsed = 0;
  const bodies = segments.map((a) => {
    const fid = typeof a.meta?.transcriptFileId === 'string' ? a.meta.transcriptFileId : '';
    const raw = fid ? (rawTextByFileId.get(fid) ?? '') : '';
    const useRaw = !!raw.trim() && rawUsed < MAX_RAW_SEGMENTS;
    if (useRaw) rawUsed++;
    // Hydrated bodies are the raw text ALONE — no title prefix. The title is the
    // model-written summary the log-call grounding never saw; letting the scan
    // quote from it would mint a different dedupeKey for the same commitment.
    const bodyFull = useRaw ? raw : (a.title ? a.title + ' — ' : '') + (a.detail ?? '');
    const cap = useRaw ? RAW_SEGMENT_CHARS : SEGMENT_CHARS;
    return bodyFull.length > cap ? (truncated++, bodyFull.slice(0, cap)) : bodyFull;
  });
  const segmentsText = segments.map((a, i) => `[#${i} | ${a.at} | ${a.type}] ${bodies[i]}`).join('\n\n');

  const ai = getAI();
  try {
    const { system, prompt } = calendarScanPrompt(segmentsText);
    const raw = await ai.generateJSON<{ events?: RawEvent[] }>({ system, prompt, maxTokens: 1800 });
    const list = Array.isArray(raw?.events) ? raw.events : [];

    const out: DetectedEvent[] = [];
    const seen = new Set<string>();
    for (const e of list) {
      const ref = typeof e.ref === 'number' ? e.ref : -1;
      const seg = segments[ref];
      if (!seg) continue;                                   // bad/absent ref
      const d = groundEvent(profile.id, { id: seg.id, at: seg.at, haystack: bodies[ref] }, e);
      if (!d || seen.has(d.dedupeKey)) continue;            // gate failed / duplicate within one scan
      seen.add(d.dedupeKey);
      out.push(d);
    }
    return { events: out, provider: ai.name, stats: { segments: segments.length, raw: list.length, kept: out.length, truncated } };
  } catch (err) {
    return { events: [], provider: 'error', error: (err as Error).message || 'Calendar scan failed.' };
  }
}
