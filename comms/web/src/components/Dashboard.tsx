import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api, type MarketSnapshot, type Metric } from '../lib/api';
import { MetricCard } from './MetricCard';
import { PriceExplorer } from './PriceExplorer';

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
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    return api.market()
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(String(e.message)))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (err && !data) return <p className="text-sm text-up">Couldn’t load market data: {err}</p>;
  if (!data) return <p className="text-sm text-brand-muted">Loading market data…</p>;

  const groups = groupMetrics(data.metrics);
  const liveCount = data.metrics.filter((m) => m.sourceName !== 'Sample data').length;
  const mix = [...data.generationMix].sort((a, b) => b.pct - a.pct);
  const topFuel = mix[0];
  const maxPct = topFuel?.pct || 1;

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
              <span className="text-[11px] text-brand-greenDark bg-brand-green/10 px-2 py-0.5 rounded-full font-medium">
                {liveCount} of {data.metrics.length} metrics live
              </span>
            </div>
            <p className="text-sm text-brand-muted mt-1.5">{marketLine(data.metrics)}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <div className="label">As of</div>
              <div className="text-sm font-medium">{new Date(data.asOf).toLocaleString('en-GB')}</div>
            </div>
            <button
              className="btn-ghost !px-2.5 !py-2"
              onClick={load}
              disabled={refreshing}
              title="Refresh market data"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </section>

      {/* Detailed price history */}
      <PriceExplorer />

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
        <div className="grid sm:grid-cols-[200px_1fr] gap-6 items-center">
          <div className="h-48 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={mix}
                  dataKey="pct"
                  nameKey="fuel"
                  innerRadius={54}
                  outerRadius={80}
                  paddingAngle={1.5}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {mix.map((g, i) => <Cell key={g.fuel} fill={FUEL_COLORS[i % FUEL_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v}%`, n]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            {topFuel && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="text-center">
                  <div className="font-mono text-xl font-semibold leading-none">{topFuel.pct}%</div>
                  <div className="text-[11px] text-brand-muted mt-0.5">{topFuel.fuel}</div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {mix.map((g, i) => (
              <div key={g.fuel} className="flex items-center gap-2.5 text-sm">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: FUEL_COLORS[i % FUEL_COLORS.length] }} />
                <span className="w-28 text-brand-ink truncate shrink-0">{g.fuel}</span>
                <div className="flex-1 h-1.5 rounded-full bg-brand-line/60 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(g.pct / maxPct) * 100}%`, background: FUEL_COLORS[i % FUEL_COLORS.length] }}
                  />
                </div>
                <span className="font-mono text-brand-muted w-10 text-right shrink-0">{g.pct}%</span>
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
