// Deterministic date utilities for the Calendar — the loose contract-end parser,
// renewal-window maths, consumption weighting, and the grid/format helpers. All
// pure functions so the live-computed yearly view is stable frame-to-frame.
//
// Contract-end values are free text a human typed ('Sep 2026', '01/09/2026',
// 'out of contract', 'rolling', blank). We parse UK day-first, resolve a bare
// month to its NEXT future occurrence (never silently this-year-in-the-past), and
// route genuine non-dates to a "needs a date" state rather than guessing — a
// mis-parsed renewal is more dangerous than an unparsed one.

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
// Strings that look like a field but aren't a date — never become a marker.
const NON_DATE = /\b(out of contract|out-of-contract|ooc|rolling|deemed|variable|tbc|to be confirmed|to be advised|tba|unknown|various|ask supplier|n\/?a|none)\b/;

export type DatePrecision = 'day' | 'month' | 'quarter';
export type ParsedContractEnd =
  | { ok: true; date: Date; precision: DatePrecision; inferredYear: boolean; confidence: 'high' | 'medium' | 'low'; raw: string }
  | { ok: false; reason: 'empty' | 'non-date' | 'unparseable'; raw: string };

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);
const lastOfMonth = (year: number, monthIdx: number): Date => new Date(year, monthIdx + 1, 0);

/** Parse a free-text contract-end string. Day-first; bare month → next future. */
export function parseContractEnd(raw: string, now: Date = new Date()): ParsedContractEnd {
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, reason: 'empty', raw };
  const lower = s.toLowerCase();
  if (NON_DATE.test(lower)) return { ok: false, reason: 'non-date', raw };

  // ISO yyyy-mm-dd (day precision, unambiguous).
  const iso = lower.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return { ok: true, date: d, precision: 'day', inferredYear: false, confidence: 'high', raw };
  }

  // Quarter: "Q3 2026", "Q3", "end of Q3 26" → last month of that quarter.
  const q = lower.match(/q\s*([1-4])(?:[^\d]*(\d{2,4}))?/);
  if (q) {
    const quarter = Number(q[1]);
    const monthIdx = quarter * 3 - 1; // Q1→Mar(2), Q2→Jun(5), Q3→Sep(8), Q4→Dec(11)
    let year = q[2] ? fullYear(Number(q[2])) : now.getFullYear();
    let inferredYear = !q[2];
    if (inferredYear && lastOfMonth(year, monthIdx) < startOfDay(now)) { year += 1; }
    return { ok: true, date: lastOfMonth(year, monthIdx), precision: 'quarter', inferredYear, confidence: inferredYear ? 'low' : 'medium', raw };
  }

  // mm/yyyy (month-first, the common UK shorthand) → month precision. Handled
  // before the day-first numeric branch because a 2-part value with a 4-digit
  // tail is unambiguously month/year (the day-first form needs three parts).
  const my = lower.match(/^(\d{1,2})[/.\- ](\d{4})$/);
  if (my) {
    const mm = Number(my[1]);
    if (mm >= 1 && mm <= 12) return { ok: true, date: lastOfMonth(Number(my[2]), mm - 1), precision: 'month', inferredYear: false, confidence: 'medium', raw };
  }

  // Numeric d/m/y (UK day-first) or yyyy/mm, separators / - .
  const numParts = lower.match(/^(\d{1,4})[/.\- ](\d{1,2})(?:[/.\- ](\d{2,4}))?$/);
  if (numParts) {
    const a = Number(numParts[1]); const b = Number(numParts[2]); const c = numParts[3] ? Number(numParts[3]) : undefined;
    // yyyy/mm (ISO-ish without day).
    if (c === undefined && numParts[1].length === 4) {
      return { ok: true, date: lastOfMonth(a, Math.min(Math.max(b, 1), 12) - 1), precision: 'month', inferredYear: false, confidence: 'medium', raw };
    }
    if (c !== undefined && a >= 1 && a <= 31 && b >= 1 && b <= 12) {
      const d = new Date(fullYear(c), b - 1, a);
      if (!Number.isNaN(d.getTime())) return { ok: true, date: d, precision: 'day', inferredYear: false, confidence: 'high', raw };
    }
  }

  // Month name anywhere, with an OPTIONAL leading day and optional year:
  // "Sep 2026", "End of March 2026", "30 June 2026", "22nd Aug 2026",
  // "September", "Sep-26". We scan for the month token (so leading words like
  // "End of" don't defeat the parse) and KEEP the day when present — collapsing
  // "15 June 2026" to a month-end date would be a silent mis-parse.
  const mName = lower.match(/(?:\b(\d{1,2})(?:st|nd|rd|th)?\s+)?\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[ \-/]*(\d{2,4})?/);
  if (mName && MONTH_LOOKUP[mName[2]] !== undefined) {
    const monthIdx = MONTH_LOOKUP[mName[2]];
    const inferredYear = !mName[3];
    let year = mName[3] ? fullYear(Number(mName[3])) : now.getFullYear();
    const day = mName[1] ? Number(mName[1]) : undefined;
    // Bare month with no year → the NEXT future occurrence.
    if (inferredYear && lastOfMonth(year, monthIdx) < startOfDay(now)) year += 1;
    // A valid in-range day → day precision; otherwise the contract-end month.
    if (day !== undefined && day >= 1 && day <= lastOfMonth(year, monthIdx).getDate()) {
      return { ok: true, date: new Date(year, monthIdx, day), precision: 'day', inferredYear, confidence: inferredYear ? 'medium' : 'high', raw };
    }
    return { ok: true, date: lastOfMonth(year, monthIdx), precision: 'month', inferredYear, confidence: inferredYear ? 'low' : 'high', raw };
  }

  return { ok: false, reason: 'unparseable', raw };
}

/** When the re-tender window opens — contract-end minus the lead time (default 6 months). */
export function renewalWindowOpen(end: Date, leadMonths = 6): Date {
  return addMonths(end, -leadMonths);
}

/** Annual kWh from a loose consumption string ("450,000 kWh" → 450000, "1.2 GWh" → 1200000). */
export function consumptionKwh(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  // Unit-aware: GWh ×1e6, MWh ×1e3, else kWh. (kWh contains neither "gwh"/"mwh".)
  const mult = /g\s*wh/.test(s) ? 1_000_000 : /m\s*wh/.test(s) ? 1000 : 1;
  // Strip thousands separators + the unit, keep digits + a single decimal point.
  const cleaned = s.replace(/,/g, '').replace(/[^0-9.]/g, '');
  if (!cleaned || (cleaned.match(/\./g) || []).length > 1) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : null;
}

// ── plain date helpers (browser-local; a UK operator's local time IS Europe/London) ──
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Month shift that clamps day overflow: subtracting 6 months from the 31st must
// land on the last day of the target month, not roll forward into the next one
// (else a re-tender marker computed off a month-end date is 1–3 days late).
export const addMonths = (d: Date, n: number): Date => {
  const r = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  if (r.getDate() !== d.getDate()) r.setDate(0); // overflowed → back to intended month-end
  return r;
};
export const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const sameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b);

/** A Monday-first 6×7 grid of dates covering the given month (with spill days). */
export function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 0 = Monday
  const start = addDays(first, -offset);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) row.push(addDays(start, w * 7 + d));
    weeks.push(row);
  }
  return weeks;
}

/** Short relative label for an event's due date. */
export function dueLabel(iso: string, allDay = true, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = startOfDay(now);
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  const time = !allDay ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  if (diff < 0) return diff === -1 ? 'Yesterday' : `${Math.abs(diff)}d overdue`;
  if (diff === 0) return time ? `Today · ${time}` : 'Today';
  if (diff === 1) return time ? `Tomorrow · ${time}` : 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' }) + (time ? ` · ${time}` : '');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (time ? ` · ${time}` : '');
}

export const isOverdue = (iso: string, now: Date = new Date()): boolean => startOfDay(new Date(iso)) < startOfDay(now);
export const isToday = (iso: string, now: Date = new Date()): boolean => sameDay(new Date(iso), now);

export const formatDayMonth = (d: Date): string => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const formatMonthYear = (d: Date): string => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
export const formatKwh = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} GWh` : `${Math.round(n).toLocaleString('en-GB')} kWh`);
