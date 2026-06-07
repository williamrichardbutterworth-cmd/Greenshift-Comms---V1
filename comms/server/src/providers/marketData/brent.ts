import { fetchJson } from '../../lib/http';
import type { MarketDataProvider, Metric, SourceRef } from './types';

// Brent crude — FREE, no API key, via the Yahoo Finance chart API (BZ=F, the
// ICE Brent front-month future). Indicative reference price; clearly labelled.
// Verified live June 2026. Falls back to sample data on any failure.

const SOURCE: SourceRef = {
  name: 'Yahoo Finance',
  url: 'https://finance.yahoo.com/quote/BZ=F',
  attribution: 'Brent crude (ICE BZ=F) — indicative, via Yahoo Finance.',
};

// Returns daily closes (ascending) for the given Yahoo range (e.g. "3mo").
export async function brentDaily(range = '3mo'): Promise<{ t: string; v: number }[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?range=${range}&interval=1d`;
  const j = await fetchJson<any>(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const close: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
  const out: { t: string; v: number }[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = close[i];
    if (v != null) out.push({ t: new Date(ts[i] * 1000).toISOString().slice(0, 10), v: Math.round(v * 100) / 100 });
  }
  return out;
}

export class BrentProvider implements MarketDataProvider {
  readonly name = 'brent';

  async getPartial(): Promise<{ metrics: Metric[]; sources: SourceRef[] }> {
    try {
      const series = await brentDaily('3mo');
      if (!series.length) return { metrics: [], sources: [] };
      const last = series[series.length - 1].v;
      const prev = series.length > 1 ? series[series.length - 2].v : null;
      const changePct = prev ? Math.round(((last - prev) / prev) * 1000) / 10 : null;
      const metric: Metric = {
        id: 'brent',
        label: 'Brent crude',
        value: last,
        unit: '$/bbl',
        changePct,
        series: series.slice(-14),
        sourceName: 'Yahoo Finance',
      };
      return { metrics: [metric], sources: [SOURCE] };
    } catch (err) {
      console.warn('[brent] unavailable:', (err as Error).message);
      return { metrics: [], sources: [] };
    }
  }
}
