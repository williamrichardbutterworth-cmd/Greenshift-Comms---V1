import { useEffect, useState } from 'react';
import { api, type MarketSnapshot } from '../lib/api';
import { MetricCard } from './MetricCard';

export function Dashboard() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.market().then(setData).catch((e) => setErr(String(e.message)));
  }, []);

  if (err) return <p className="text-sm text-up">Couldn’t load market data: {err}</p>;
  if (!data) return <p className="text-sm text-brand-muted">Loading market data…</p>;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.metrics.map((m) => (
          <MetricCard key={m.id} m={m} />
        ))}
      </section>

      <section className="card p-5">
        <div className="label mb-3">GB generation mix (now)</div>
        <div className="space-y-2">
          {data.generationMix.map((g) => (
            <div key={g.fuel} className="flex items-center gap-3">
              <div className="w-24 text-sm text-brand-ink">{g.fuel}</div>
              <div className="flex-1 h-2.5 rounded-full bg-brand-tint overflow-hidden">
                <div className="h-full rounded-full bg-brand-green" style={{ width: `${g.pct}%` }} />
              </div>
              <div className="w-10 text-right font-mono text-sm">{g.pct}%</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="text-xs text-brand-muted space-y-1">
        <div>Data as of {new Date(data.asOf).toLocaleString('en-GB')}.</div>
        {data.sources
          .filter((s) => s.attribution)
          .map((s) => (
            <div key={s.name}>{s.attribution}</div>
          ))}
        <div className="italic">Indicative, for information only — not a price quotation.</div>
      </footer>
    </div>
  );
}
