import type { Metric, FuelShare, SourceRef } from './types';

// Realistic-looking sample data so the dashboard is populated on first run
// with no network and no keys. Numbers are illustrative, not live.
function series(base: number, n = 14, jitter = 0.04): { t: string; v: number }[] {
  const out: { t: string; v: number }[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const v = base * (1 + (Math.sin(i / 2) * jitter) + (Math.random() - 0.5) * jitter);
    out.push({ t: d.toISOString().slice(0, 10), v: Math.round(v * 100) / 100 });
  }
  return out;
}

export function mockMetrics(): {
  metrics: Metric[];
  generationMix: FuelShare[];
  sources: SourceRef[];
} {
  const metrics: Metric[] = [
    {
      id: 'nbp_gas',
      label: 'Wholesale gas (NBP)',
      value: 96.4,
      unit: 'p/therm',
      changePct: 1.8,
      series: series(95),
      sourceName: 'Sample data',
    },
    {
      id: 'power_da',
      label: 'Day-ahead power',
      value: 78.2,
      unit: '£/MWh',
      changePct: -2.1,
      series: series(80),
      sourceName: 'Sample data',
    },
    {
      id: 'elec_demand',
      label: 'GB electricity demand',
      value: 31.7,
      unit: 'GW',
      changePct: 3.4,
      series: series(31),
      sourceName: 'Sample data',
    },
    {
      id: 'gas_demand',
      label: 'GB gas demand',
      value: 214,
      unit: 'mcm/day',
      changePct: 5.2,
      series: series(205),
      sourceName: 'Sample data',
    },
    {
      id: 'brent',
      label: 'Brent crude',
      value: 82.5,
      unit: '$/bbl',
      changePct: 0.6,
      series: series(82),
      sourceName: 'Sample data',
    },
    {
      id: 'gas_storage',
      label: 'Gas storage',
      value: 71,
      unit: '% full',
      changePct: -0.9,
      series: series(72, 14, 0.01),
      sourceName: 'Sample data',
    },
  ];

  const generationMix: FuelShare[] = [
    { fuel: 'Wind', pct: 38 },
    { fuel: 'Gas (CCGT)', pct: 27 },
    { fuel: 'Nuclear', pct: 14 },
    { fuel: 'Imports', pct: 10 },
    { fuel: 'Solar', pct: 6 },
    { fuel: 'Other', pct: 5 },
  ];

  const sources: SourceRef[] = [
    { name: 'Sample data', url: '', attribution: 'Illustrative sample data — replace with live sources.' },
  ];

  return { metrics, generationMix, sources };
}
