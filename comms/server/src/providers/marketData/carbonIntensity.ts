import { fetchJson } from '../../lib/http';
import type { MarketDataProvider, Metric, SourceRef } from './types';

// NESO Carbon Intensity API — FREE, public, no API key required.
// Docs: https://carbon-intensity.github.io/api-definitions/
// Licensed CC BY 4.0 — the attribution below MUST be shown wherever it appears.
//
// Contributes one national-grid metric to the market snapshot: live carbon
// intensity (gCO₂/kWh) with a 24h sparkline and a plain-English index word.
// Regional data + fuel mix for the generation map is served separately by
// services/gridSnapshot.ts (GET /api/grid).

export const CARBON_ATTRIBUTION =
  'Carbon intensity data by the National Energy System Operator (NESO), licensed under CC BY 4.0.';
export const CARBON_SOURCE: SourceRef = {
  name: 'NESO Carbon Intensity',
  url: 'https://carbonintensity.org.uk',
  attribution: CARBON_ATTRIBUTION,
};

const BASE = 'https://api.carbonintensity.org.uk';

interface CIPeriod {
  from: string;
  to: string;
  intensity: { forecast: number | null; actual: number | null; index: string | null };
}

// Index → a short "what this means" line for the metric card.
const INDEX_MEANING: Record<string, string> = {
  'very low': 'Very clean grid right now',
  low: 'Cleaner power than average',
  moderate: 'Average grid carbon intensity',
  high: 'Dirtier power than average',
  'very high': 'Very carbon-intensive grid right now',
};

const isoHoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
// The API takes minute-precision ISO timestamps (YYYY-MM-DDTHH:MMZ).
const toMinuteIso = (iso: string) => iso.slice(0, 16) + 'Z';

export class CarbonIntensityProvider implements MarketDataProvider {
  readonly name = 'carbonIntensity';

  async getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[] }> {
    const metrics: Metric[] = [];
    try {
      const from = toMinuteIso(isoHoursAgo(24));
      const to = toMinuteIso(new Date().toISOString());
      const raw = await fetchJson<{ data: CIPeriod[] }>(`${BASE}/intensity/${from}/${to}`);
      const periods = (raw?.data ?? []).filter((p) => p?.intensity);
      // Prefer the metered "actual"; fall back to forecast for the latest few periods.
      const series = periods
        .map((p) => ({ t: p.from, v: p.intensity.actual ?? p.intensity.forecast }))
        .filter((p): p is { t: string; v: number } => Number.isFinite(p.v as number));

      if (series.length) {
        const last = series[series.length - 1];
        // Compare to the immediately preceding reading (matching the "previous
        // reading" label and the other metric cards). Carbon intensity is highly
        // diurnal, so a vs-24h-ago figure would surface alarming swings.
        const prev = series.length >= 2 ? series[series.length - 2] : null;
        const changePct = prev && prev.v ? Math.round(((last.v - prev.v) / prev.v) * 1000) / 10 : null;
        const latestIndex = [...periods].reverse().find((p) => p.intensity.index)?.intensity.index ?? null;
        metrics.push({
          id: 'carbon_intensity',
          label: 'Grid carbon intensity',
          value: Math.round(last.v),
          unit: 'gCO₂/kWh',
          changePct,
          series,
          meaning: latestIndex ? INDEX_MEANING[latestIndex] ?? `${latestIndex} carbon intensity` : undefined,
          sourceName: CARBON_SOURCE.name,
        });
      }
    } catch (err) {
      console.warn('[carbonIntensity] national intensity unavailable:', (err as Error).message);
    }

    return { metrics, sources: metrics.length ? [CARBON_SOURCE] : [] };
  }
}
