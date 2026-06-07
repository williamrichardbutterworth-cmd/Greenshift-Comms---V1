import { config } from '../../config';
import { mockMetrics } from './mock';
import { ElexonProvider } from './elexon';
import { NationalGasProvider } from './nationalGas';
import { HeadlinePriceProvider } from './headlinePrice';
import { BrentProvider } from './brent';
import type { MarketSnapshot, Metric, SourceRef, FuelShare, MarketDataProvider } from './types';

// Live providers run in parallel; whatever each returns is merged OVER the
// sample data by metric id. So the dashboard is always fully populated, even
// if a source is down or not yet implemented. Add a paid source by writing a
// new provider and pushing it into this list (see docs/PROVIDERS.md).
const liveProviders: MarketDataProvider[] = [
  new ElexonProvider(),
  new NationalGasProvider(),
  new HeadlinePriceProvider(),
  new BrentProvider(),
];

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const seed = mockMetrics();
  const byId = new Map<string, Metric>(seed.metrics.map((m) => [m.id, m]));
  let generationMix: FuelShare[] = seed.generationMix;
  const sources: SourceRef[] = [...seed.sources];

  if (config.useLiveMarketData) {
    const results = await Promise.allSettled(liveProviders.map((p) => p.getPartial()));
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        console.warn('[market] provider failed:', r.reason?.message ?? r.reason);
        continue;
      }
      for (const m of r.value.metrics) byId.set(m.id, m); // live overrides sample
      if (r.value.generationMix?.length) generationMix = r.value.generationMix;
      for (const s of r.value.sources) {
        if (!sources.some((x) => x.name === s.name)) sources.push(s);
      }
    }
    // Once at least one live source contributes, drop the "sample data" note.
    if (sources.length > 1) {
      const i = sources.findIndex((s) => s.name === 'Sample data');
      if (i >= 0) sources.splice(i, 1);
    }
  }

  return {
    asOf: new Date().toISOString(),
    metrics: [...byId.values()],
    generationMix,
    sources,
  };
}

export type { MarketSnapshot } from './types';
