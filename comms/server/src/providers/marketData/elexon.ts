import { config } from '../../config';
import { fetchJson } from '../../lib/http';
import type { MarketDataProvider, Metric, FuelShare, SourceRef } from './types';

// Elexon Insights Solution (BMRS) — FREE, public, no API key required.
// Docs / endpoint explorer: https://developer.data.elexon.co.uk
//
// Endpoints below were verified live against the API (June 2026):
//   - generation mix  : /datasets/FUELINST  (fuelType, generation, startTime)
//   - day-ahead power : /balancing/pricing/market-index  (use APXMIDP; N2EX is 0)
//   - electricity demand: /datasets/INDO    (demand in MW)
// Each call is isolated in try/catch so a partial failure leaves the matching
// metric to fall back to sample data — the dashboard is never broken by a bad call.

const ATTRIBUTION =
  'Contains data from Elexon Insights (BMRS), used under the BMRS Data Licence Terms.';
const SOURCE: SourceRef = {
  name: 'Elexon (BMRS)',
  url: 'https://bmrs.elexon.co.uk',
  attribution: ATTRIBUTION,
};

function isoHoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}
const nowIso = () => new Date().toISOString();

// The market-index/INDO endpoints cap the queryable range, so we use a 7-day
// window — enough for a daily trend sparkline and a day-on-day comparison.
const WINDOW_H = 7 * 24;

// Collapse half-hourly points into one mean per calendar day (UTC), ascending.
// Half-hourly market-index prices are very spiky, so a daily mean is the
// representative "where the market is" figure rather than a volatile spot tick.
function dailyMeans(points: { t: string; v: number }[]): { t: string; v: number }[] {
  const byDay = new Map<string, number[]>();
  for (const p of points) {
    const k = p.t.slice(0, 10);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(p.v);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, vs]) => ({ t, v: Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10 }));
}

// Day-on-day %: latest daily mean vs the previous day's.
function dayOnDay(daily: { v: number }[]): number | null {
  if (daily.length < 2) return null;
  const prev = daily[daily.length - 2].v;
  const last = daily[daily.length - 1].v;
  if (!prev) return null;
  return Math.round(((last - prev) / prev) * 1000) / 10;
}

async function getRows(url: string): Promise<any[]> {
  const raw = await fetchJson<any>(url);
  return Array.isArray(raw) ? raw : raw?.data ?? [];
}

// Friendly names for Elexon FUELINST fuel codes. All interconnectors (INT*) are
// grouped into "Imports". Note: embedded solar is NOT in this transmission-level
// dataset, so the live mix won't show solar.
const FUEL_NAME: Record<string, string> = {
  WIND: 'Wind',
  CCGT: 'Gas',
  OCGT: 'Gas',
  NUCLEAR: 'Nuclear',
  BIOMASS: 'Biomass',
  COAL: 'Coal',
  OIL: 'Oil',
  NPSHYD: 'Hydro',
  PS: 'Pumped storage',
  OTHER: 'Other',
};

export class ElexonProvider implements MarketDataProvider {
  readonly name = 'elexon';

  async getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[]; generationMix?: FuelShare[] }> {
    const metrics: Metric[] = [];
    let generationMix: FuelShare[] | undefined;
    const base = config.elexonBaseUrl;

    // --- Generation mix (latest settlement period of FUELINST), cleaned ---
    try {
      const rows = await getRows(
        `${base}/datasets/FUELINST?publishDateTimeFrom=${encodeURIComponent(isoHoursAgo(6))}` +
          `&publishDateTimeTo=${encodeURIComponent(nowIso())}&format=json`,
      );
      if (rows.length) {
        const latestTime = rows.reduce((m, r) => (r.startTime > m ? r.startTime : m), rows[0].startTime);
        const latest = rows.filter((r) => r.startTime === latestTime);
        const byFuel = new Map<string, number>();
        let imports = 0;
        for (const r of latest) {
          const v = Number(r.generation) || 0;
          if (String(r.fuelType ?? '').startsWith('INT')) {
            imports += v; // net interconnector flow
            continue;
          }
          const name = FUEL_NAME[r.fuelType] ?? 'Other';
          byFuel.set(name, (byFuel.get(name) ?? 0) + v);
        }
        if (imports > 0) byFuel.set('Imports', imports); // ignore when GB is a net exporter
        const entries = [...byFuel.entries()].filter(([, v]) => v > 0); // drop pumped-storage charging etc.
        const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
        const mix = entries
          .map(([fuel, v]) => ({ fuel, pct: Math.round((v / total) * 100) }))
          .filter((f) => f.pct > 0)
          .sort((a, b) => b.pct - a.pct);
        if (mix.length) generationMix = mix;
      }
    } catch (err) {
      console.warn('[elexon] generation mix unavailable:', (err as Error).message);
    }

    // --- Day-ahead power (market index price, £/MWh) — APXMIDP, daily mean ---
    try {
      const rows = await getRows(
        `${base}/balancing/pricing/market-index?from=${encodeURIComponent(isoHoursAgo(WINDOW_H))}` +
          `&to=${encodeURIComponent(nowIso())}`,
      );
      const px = rows
        .filter((r) => r.dataProvider === 'APXMIDP' && Number(r.price) > 0)
        .map((r) => ({ t: String(r.startTime), v: Number(r.price) }));
      const daily = dailyMeans(px);
      if (daily.length) {
        metrics.push({
          id: 'power_da',
          label: 'Day-ahead power (market index)',
          value: daily[daily.length - 1].v,
          unit: '£/MWh',
          changePct: dayOnDay(daily),
          series: daily,
          sourceName: 'Elexon (BMRS)',
        });
      }
    } catch (err) {
      console.warn('[elexon] market index price unavailable:', (err as Error).message);
    }

    // --- GB electricity demand (INDO, MW -> GW), daily mean ---
    try {
      const rows = await getRows(
        `${base}/datasets/INDO?publishDateTimeFrom=${encodeURIComponent(isoHoursAgo(WINDOW_H))}` +
          `&publishDateTimeTo=${encodeURIComponent(nowIso())}&format=json`,
      );
      const dem = rows
        .filter((r) => Number(r.demand) > 0)
        .map((r) => ({ t: String(r.startTime), v: Number(r.demand) / 1000 }));
      const daily = dailyMeans(dem);
      if (daily.length) {
        metrics.push({
          id: 'elec_demand',
          label: 'GB electricity demand',
          value: daily[daily.length - 1].v,
          unit: 'GW',
          changePct: dayOnDay(daily),
          series: daily,
          sourceName: 'Elexon (BMRS)',
        });
      }
    } catch (err) {
      console.warn('[elexon] demand unavailable:', (err as Error).message);
    }

    const sources: SourceRef[] = metrics.length || generationMix ? [SOURCE] : [];
    return { metrics, sources, generationMix };
  }
}
