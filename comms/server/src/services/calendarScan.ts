import { createHash } from 'node:crypto';
import { getAI } from '../providers/ai';
import { aiConfigured } from '../config';
import { calendarScanPrompt } from './prompts';
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

export interface CalendarScanResult {
  events: DetectedEvent[];
  provider: string;
  error?: string;
  /** Visibility into the drop gates so a silently-empty scan is distinguishable from a real one. */
  stats?: { segments: number; raw: number; kept: number; truncated: number };
}

interface RawEvent {
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

export async function scanClientCalendar(profile: ClientProfile): Promise<CalendarScanResult> {
  if (!aiConfigured()) return { events: [], provider: 'none' };

  // Build the segment list (newest-first array, but indexed so the model can ref back).
  const segments = profile.activities
    .filter((a) => MINEABLE.has(a.type) && (a.detail || a.title))
    .slice(0, MAX_SEGMENTS);
  if (!segments.length) return { events: [], provider: 'none', stats: { segments: 0, raw: 0, kept: 0, truncated: 0 } };

  // Slice the BODY (not the prefixed line) to SEGMENT_CHARS so the constant means
  // what it says regardless of prefix length, and count truncations so a
  // silently-shortened scan is distinguishable from a genuinely empty one.
  let truncated = 0;
  const segmentsText = segments
    .map((a, i) => {
      const prefix = `[#${i} | ${a.at} | ${a.type}] `;
      const bodyFull = (a.title ? a.title + ' — ' : '') + (a.detail ?? '');
      const body = bodyFull.length > SEGMENT_CHARS ? (truncated++, bodyFull.slice(0, SEGMENT_CHARS)) : bodyFull;
      return prefix + body;
    })
    .join('\n\n');

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
      if (e.nature !== 'commitment') continue;              // hypothetical/past/negated/third-party
      const kind = e.kind as CalendarKind;
      if (!SCAN_KINDS.has(kind)) continue;
      const due = typeof e.dueISO === 'string' ? e.dueISO.trim() : '';
      const t = Date.parse(due);
      if (!Number.isFinite(t)) continue;                    // unparseable date
      const start = new Date(t).toISOString();
      // A commitment can't fall before it was logged (drop stale/past resolutions).
      // Only apply the gate when the activity timestamp itself parses cleanly —
      // otherwise a malformed `at` would compare arbitrary substrings.
      const segMs = Date.parse(seg.at);
      if (Number.isFinite(segMs) && londonDay(start) < londonDay(new Date(segMs).toISOString())) continue;

      // Provenance gate: the quote must genuinely appear in the cited segment, be
      // substantial (not a trivially-common fragment), and the resolved date phrase
      // must also be present — so a real sentence can't anchor a fabricated date.
      const source = typeof e.source === 'string' ? e.source.trim() : '';
      const dueText = typeof e.dueText === 'string' ? e.dueText.trim() : '';
      const haystack = `${seg.title ?? ''} ${seg.detail ?? ''}`;
      const nHay = norm(haystack);
      if (!source || norm(source).length < 12 || !nHay.includes(norm(source))) continue;
      if (dueText && !nHay.includes(norm(dueText))) continue; // date phrase must be grounded too

      // Idempotency key from immutable provenance + the verbatim source sentence
      // (NOT the resolved date): a re-scan that resolves the same commitment to a
      // slightly different date keys identically and UPDATES in place, while two
      // distinct commitments in one activity (different sentences) stay separate.
      const dedupeKey = createHash('sha1').update(`${profile.id}|${kind}|${seg.id}|${norm(source)}`).digest('hex');
      if (seen.has(dedupeKey)) continue;                    // collapse exact duplicates within one scan
      seen.add(dedupeKey);

      out.push({
        dedupeKey,
        title: (typeof e.title === 'string' && e.title.trim() ? e.title.trim() : 'Reminder').slice(0, 200),
        start,
        allDay: e.allDay !== false,
        kind,
        clientProfileId: profile.id,
        source: source.slice(0, 600),
        sourceActivityId: seg.id,
        confidence: coerceConf(e.confidence),
      });
    }
    return { events: out, provider: ai.name, stats: { segments: segments.length, raw: list.length, kept: out.length, truncated } };
  } catch (err) {
    return { events: [], provider: 'error', error: (err as Error).message || 'Calendar scan failed.' };
  }
}
