// ── Report template engine ──
// Renders a token HTML template against a value map + repeatable lists.
// Token syntax (mustache-ish):
//   {{token}}              → escaped text value
//   {{{token}}}            → raw HTML fragment (for sign glyphs, pills, etc.)
//   {{#each name}}…{{/each}} → repeat the inner block for each row in lists[name]
// Inside an each-block, row keys win over top-level tokens.

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function substitute(tpl: string, scope: Record<string, string>): string {
  return tpl
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, k: string) => scope[k] ?? '')
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => escapeHtml(scope[k] ?? ''));
}

export function renderTemplate(
  html: string,
  tokens: Record<string, string>,
  lists: Record<string, Array<Record<string, string>>> = {},
): string {
  const withLists = html.replace(
    /\{\{#each\s+(\w+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, name: string, inner: string) =>
      (lists[name] ?? []).map((row) => substitute(inner, { ...tokens, ...row })).join(''),
  );
  return substitute(withLists, tokens);
}

// All token keys referenced by a template (for diagnostics / future auto-parse).
export function tokensIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g)) {
    if (m[1] !== 'each') out.add(m[1]);
  }
  return [...out];
}

// ── Formatting helpers ──
export const parseNum = (s: string | number | undefined | null): number => {
  if (s == null) return NaN;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
export const money0 = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-GB') : '—';
export const num = (n: number, dp = 2): string =>
  Number.isFinite(n) ? n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
export const int = (n: number): string =>
  Number.isFinite(n) ? Math.round(n).toLocaleString('en-GB') : '—';
export const pct0 = (n: number): string => (Number.isFinite(n) ? `${Math.round(n)}%` : '—');

// Long UK date from an ISO string / Date / loose date text. Falls back to the input.
export function dateLong(input: string | Date | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
export const todayLong = (): string =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
export const addDaysLong = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

// Parse a term like "36-month fixed" / "3 year" / "24m" → whole years (min 1).
// Allows an optional hyphen between the number and the unit (e.g. "36-month").
export function termYears(term: string): number {
  const months = /(\d+)\s*-?\s*(?:months?|mo|m)\b/i.exec(term);
  if (months) return Math.max(1, Math.round(Number(months[1]) / 12));
  const years = /(\d+)\s*-?\s*(?:years?|yr|y)\b/i.exec(term);
  if (years) return Math.max(1, Number(years[1]));
  return 1;
}

// Annual cost (£) from a unit rate (p/kWh), standing charge (p/day) and annual kWh.
export function annualCost(unitRateP: number, standingPDay: number, annualKwh: number): number {
  const energy = (unitRateP / 100) * annualKwh;
  const standing = (standingPDay / 100) * 365;
  return energy + standing;
}

// Annual cost (£) for a day/night (Economy-7) meter — the canonical comparison formula,
// matching the Excel: (dayKwh·dayRate + nightKwh·nightRate + standing·365) / 100.
// NaN rates/consumption are treated as 0 so a half-filled row still totals sensibly.
export function meterAnnualCost(
  dayKwh: number, dayRateP: number, nightKwh: number, nightRateP: number, standingPDay: number,
): number {
  const z = (n: number) => (Number.isFinite(n) ? n : 0);
  return (z(dayKwh) * z(dayRateP) + z(nightKwh) * z(nightRateP) + z(standingPDay) * 365) / 100;
}
