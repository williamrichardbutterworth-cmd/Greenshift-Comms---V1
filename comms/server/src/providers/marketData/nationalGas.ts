import { config } from '../../config';
import { fetchText } from '../../lib/http';
import type { MarketDataProvider, Metric, SourceRef } from './types';

// National Gas Transmission Data Portal — FREE, open data, no API key required.
// We use the portal's own "Find Gas Data" download endpoint (verified live,
// June 2026), which returns CSV for one or more publication-object ids:
//   GET /api/find-gas-data-download?ids=<PUBOB..>&applicableFor=Y
//       &dateType=GASDAY&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&latestFlag=N&type=CSV
//
// Data items used (ids from the portal's data-item catalogue):
//   PUBOB623 = "Demand Forecast, NTS"  (mcm/day — the headline GB gas demand)
//   PUBOB47  = "SAP, hourly actual"    (p/kWh — System Average Price of gas)
//
// Each item is fetched independently and wrapped, so a partial failure simply
// leaves that metric to fall back to sample data — the dashboard never breaks.
// Note: storage "% full" is not published here (National Gas exposes flows, not
// stock levels); that metric stays on sample data until an AGSI+ feed is added.

const ATTRIBUTION =
  'Contains data from National Gas Transmission, used under the Gas System Operator data terms.';
const SOURCE: SourceRef = { name: 'National Gas', url: 'https://data.nationalgas.com', attribution: ATTRIBUTION };

const DEMAND_ID = 'PUBOB623';
const SAP_ID = 'PUBOB47';
const KWH_PER_THERM = 29.3071; // convert SAP (p/kWh) to the p/therm agents quote

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// CSV columns: Applicable At, Applicable For, Data Item, Value, Generated Time, Quality.
// Returns one point per gas day (latest value seen for that day), ascending.
function parseSeries(csv: string): { t: string; v: number }[] {
  const lines = csv.trim().split(/\r?\n/).slice(1).filter(Boolean);
  const byDay = new Map<string, number>();
  for (const line of lines) {
    const cols = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1].replace(/^"|"$/g, ''));
    if (cols.length < 4) continue;
    const [dd, mm, yy] = String(cols[1]).split(' ')[0].split('/');
    const v = Number(cols[3]);
    if (yy && mm && dd && !Number.isNaN(v)) byDay.set(`${yy}-${mm}-${dd}`, v);
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => ({ t, v }));
}

function dayOnDay(series: { v: number }[]): number | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2].v;
  const last = series[series.length - 1].v;
  return prev ? Math.round(((last - prev) / prev) * 1000) / 10 : null;
}

export class NationalGasProvider implements MarketDataProvider {
  readonly name = 'national-gas';

  private async fetchItem(id: string): Promise<{ t: string; v: number }[]> {
    const to = ymd(new Date());
    const from = ymd(new Date(Date.now() - 16 * 24 * 3600 * 1000));
    const url =
      `${config.nationalGasBaseUrl}/api/find-gas-data-download?ids=${id}` +
      `&applicableFor=Y&dateType=GASDAY&dateFrom=${from}&dateTo=${to}&latestFlag=N&type=CSV`;
    return parseSeries(await fetchText(url));
  }

  async getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[] }> {
    const metrics: Metric[] = [];

    // --- GB gas demand (NTS), mcm/day ---
    try {
      const s = await this.fetchItem(DEMAND_ID);
      if (s.length) {
        const series = s.map((p) => ({ t: p.t, v: Math.round(p.v * 10) / 10 }));
        metrics.push({
          id: 'gas_demand',
          label: 'GB gas demand (NTS)',
          value: series[series.length - 1].v,
          unit: 'mcm/day',
          changePct: dayOnDay(series),
          series,
          sourceName: 'National Gas',
        });
      }
    } catch (err) {
      console.warn('[national-gas] demand unavailable:', (err as Error).message);
    }

    // --- Gas system price: System Average Price (SAP), p/kWh -> p/therm ---
    try {
      const s = await this.fetchItem(SAP_ID);
      if (s.length) {
        const series = s.map((p) => ({ t: p.t, v: Math.round(p.v * KWH_PER_THERM * 10) / 10 }));
        metrics.push({
          id: 'gas_sap',
          label: 'Gas system price (SAP)',
          value: series[series.length - 1].v,
          unit: 'p/therm',
          changePct: dayOnDay(series),
          series,
          sourceName: 'National Gas',
        });
      }
    } catch (err) {
      console.warn('[national-gas] SAP unavailable:', (err as Error).message);
    }

    const sources: SourceRef[] = metrics.length ? [SOURCE] : [];
    return { metrics, sources };
  }
}
