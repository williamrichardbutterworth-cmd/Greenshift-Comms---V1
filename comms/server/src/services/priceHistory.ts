import { config } from '../config';
import { cache } from '../lib/cache';
import { fetchJson, fetchText } from '../lib/http';
import { brentDaily } from '../providers/marketData/brent';

// Long-term price history for the charts agents can drop into client reports.
// "Best free history available": Brent up to 1y (Yahoo), UK gas SAP up to 1y
// (National Gas), power up to ~90d (Elexon's market-index range cap). Each is
// cached for 6h and clearly labelled with its real timeframe and source.

export type SeriesKey = 'brent' | 'gas' | 'power';
export type RangeKey = '3m' | '6m' | '12m';

export interface PriceSeries {
  key: SeriesKey;
  label: string;
  unit: string;
  range: RangeKey;
  points: { t: string; v: number }[];
  sourceName: string;
  attribution?: string;
}

const RANGE_DAYS: Record<RangeKey, number> = { '3m': 90, '6m': 182, '12m': 365 };
const KWH_PER_THERM = 29.3071;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const SERIES_META: { key: SeriesKey; label: string; unit: string }[] = [
  { key: 'brent', label: 'Brent crude', unit: '$/bbl' },
  { key: 'gas', label: 'UK gas — System Average Price', unit: 'p/therm' },
  { key: 'power', label: 'Day-ahead power (market index)', unit: '£/MWh' },
];

function dailyMean(rows: { day: string; v: number }[]): { t: string; v: number }[] {
  const byDay = new Map<string, number[]>();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, []).get(r.day)!).push(r.v);
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, vs]) => ({ t, v: Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 }));
}

async function brentHistory(range: RangeKey): Promise<PriceSeries> {
  const yRange = range === '12m' ? '1y' : range === '6m' ? '6mo' : '3mo';
  const points = await brentDaily(yRange);
  return {
    key: 'brent', label: 'Brent crude', unit: '$/bbl', range, points,
    sourceName: 'Yahoo Finance', attribution: 'Brent crude (ICE BZ=F) — indicative, via Yahoo Finance.',
  };
}

async function gasHistory(range: RangeKey): Promise<PriceSeries> {
  const to = ymd(new Date());
  const from = ymd(new Date(Date.now() - RANGE_DAYS[range] * 864e5));
  const url =
    `${config.nationalGasBaseUrl}/api/find-gas-data-download?ids=PUBOB47` +
    `&applicableFor=Y&dateType=GASDAY&dateFrom=${from}&dateTo=${to}&latestFlag=N&type=CSV`;
  const csv = await fetchText(url, {}, 20000);
  const rows: { day: string; v: number }[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const cols = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;
    const [dd, mm, yy] = String(cols[1]).split(' ')[0].split('/');
    const v = Number(cols[3]);
    if (yy && mm && dd && !Number.isNaN(v)) rows.push({ day: `${yy}-${mm}-${dd}`, v: v * KWH_PER_THERM });
  }
  return {
    key: 'gas', label: 'UK gas — System Average Price', unit: 'p/therm', range, points: dailyMean(rows),
    sourceName: 'National Gas',
    attribution: 'Contains data from National Gas Transmission, used under the Gas System Operator data terms.',
  };
}

async function powerHistory(range: RangeKey): Promise<PriceSeries> {
  const days = Math.min(RANGE_DAYS[range], 90); // Elexon market-index range cap
  const chunks = Math.ceil(days / 7);
  const base = config.elexonBaseUrl;
  const fetches = Array.from({ length: chunks }, (_, c) => {
    const to = new Date(Date.now() - c * 7 * 864e5);
    const from = new Date(to.getTime() - 7 * 864e5);
    const url = `${base}/balancing/pricing/market-index?from=${from.toISOString()}&to=${to.toISOString()}`;
    return fetchJson<any>(url).then((raw) => (Array.isArray(raw) ? raw : raw?.data ?? [])).catch(() => []);
  });
  const all = (await Promise.all(fetches)).flat();
  const rows: { day: string; v: number }[] = [];
  for (const r of all) {
    if (r?.dataProvider === 'APXMIDP' && Number(r.price) > 0) {
      rows.push({ day: String(r.startTime).slice(0, 10), v: Number(r.price) });
    }
  }
  return {
    key: 'power', label: 'Day-ahead power (market index)', unit: '£/MWh', range, points: dailyMean(rows),
    sourceName: 'Elexon (BMRS)',
    attribution: 'Contains data from Elexon Insights (BMRS), used under the BMRS Data Licence Terms.',
  };
}

export async function getPriceHistory(series: SeriesKey, range: RangeKey): Promise<PriceSeries> {
  const ck = `hist:${series}:${range}`;
  const cached = cache.get<PriceSeries>(ck);
  if (cached) return cached;
  const fn = series === 'brent' ? brentHistory : series === 'gas' ? gasHistory : powerHistory;
  const result = await fn(range);
  if (result.points.length) cache.set(ck, result, 1000 * 60 * 60 * 6);
  return result;
}
