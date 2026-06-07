import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api, type MarketSnapshot, type Metric } from '../lib/api';
import { MetricCard } from './MetricCard';

// Bucket the live metrics into readable sections (order matters — storage before gas).
const GROUPS: { key: string; title: string; match: (label: string) => boolean }[] = [
  { key: 'gas', title: 'Gas', match: (l) => l.includes('gas') && !l.includes('storage') },
  { key: 'power', title: 'Power', match: (l) => l.includes('power') || l.includes('electricity') },
  { key: 'oil', title: 'Oil & storage', match: (l) => l.includes('brent') || l.includes('oil') || l.includes('storage') },
];

function groupMetrics(metrics: Metric[]) {
  const buckets = GROUPS.map((g) => ({ ...g, items: [] as Metric[] }));
  const other: Metric[] = [];
  for (const m of metrics) {
    const g = buckets.find((b) => b.match(m.label.toLowerCase()));
    (g ? g.items : other).push(m);
  }
  const out = buckets.filter((b) => b.items.length);
  if (other.length) out.push({ key: 'other', title: 'Other', match: () => false, items: other });
  return out;
}

// One-line "where the market is" from the deltas.
function marketLine(metrics: Metric[]): string {
  const pick = (...kws: string[]) =>
    metrics.find((m) => kws.some((k) => m.label.toLowerCase().includes(k)) && m.changePct != null);
  const seg = (m: Metric | undefined, name: string) => {
    if (!m || m.changePct == null) return null;
    const c = m.changePct;
    if (Math.abs(c) < 0.1) return `${name} flat`;
    return `${name} ${c > 0 ? 'up' : 'down'} ${Math.abs(c)}%`;
  };
  const parts = [
    seg(pick('wholesale gas', 'gas (nbp)', 'gas system'), 'gas'),
    seg(pick('day-ahead power', 'power'), 'power'),
    seg(pick('brent'), 'Brent'),
  ].filter(Boolean);
  return parts.length ? `Today: ${parts.join(', ')}.` : 'Live UK gas, power and oil benchmarks.';
}

const FUEL_COLORS = ['#40A800', '#318300', '#73C13B', '#9BD46A', '#2B2A2E', '#6B6A70', '#A7A6AB', '#C9C8CC'];

export function Dashboard() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.market().then(setData).catch((e) => setErr(String(e.message)));
  }, []);

  if (err) return <p className="text-sm text-up">Couldn’t load market data: {err}</p>;
  if (!data) return <p className="text-sm text-brand-muted">Loading market data…</p>;

  const groups = groupMetrics(data.metrics);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="card p-5 bg-gradient-to-br from-brand-tint to-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-green/10 text-brand-greenDark">
                <Activity size={17} />
              </span>
              <h2 className="text-lg font-semibold">UK energy market</h2>
            </div>
            <p className="text-sm text-brand-muted mt-1.5">{marketLine(data.metrics)}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="label">As of</div>
            <div className="text-sm font-medium">{new Date(data.asOf).toLocaleString('en-GB')}</div>
          </div>
        </div>
      </section>

      {/* Grouped metrics */}
      {groups.map((g) => (
        <section key={g.key}>
          <div className="label mb-2">{g.title}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map((m) => <MetricCard key={m.id} m={m} />)}
          </div>
        </section>
      ))}

      {/* Generation mix donut */}
      <section className="card p-5">
        <div className="label mb-3">GB generation mix (now)</div>
        <div className="grid sm:grid-cols-[180px_1fr] gap-5 items-center">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.generationMix}
                  dataKey="pct"
                  nameKey="fuel"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={1.5}
                  stroke="none"
                >
                  {data.generationMix.map((g, i) => <Cell key={g.fuel} fill={FUEL_COLORS[i % FUEL_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v}%`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
            {data.generationMix.map((g, i) => (
              <div key={g.fuel} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: FUEL_COLORS[i % FUEL_COLORS.length] }} />
                <span className="flex-1 text-brand-ink truncate">{g.fuel}</span>
                <span className="font-mono text-brand-muted">{g.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="text-xs text-brand-muted space-y-1">
        <div>Data as of {new Date(data.asOf).toLocaleString('en-GB')}.</div>
        {data.sources.filter((s) => s.attribution).map((s) => <div key={s.name}>{s.attribution}</div>)}
        <div className="italic">Indicative, for information only — not a price quotation.</div>
      </footer>
    </div>
  );
}
