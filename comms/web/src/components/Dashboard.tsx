import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, RefreshCw, SlidersHorizontal, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api, type MarketSnapshot, type Metric } from '../lib/api';
import { MetricCard } from './MetricCard';
import { PriceExplorer } from './PriceExplorer';
import { GenerationMap } from './GenerationMap';
import { ForwardCurvePanel } from './ForwardCurvePanel';

// Metric groups (by label keyword). Each becomes a customizable widget.
const GROUPS: { key: string; title: string; match: (label: string) => boolean }[] = [
  { key: 'gas', title: 'Gas', match: (l) => l.includes('gas') && !l.includes('storage') },
  { key: 'power', title: 'Power', match: (l) => l.includes('power') || l.includes('electricity') },
  { key: 'carbon', title: 'Carbon & grid', match: (l) => l.includes('carbon') },
  { key: 'oil', title: 'Oil & storage', match: (l) => l.includes('brent') || l.includes('oil') || l.includes('storage') },
];

function groupMetrics(metrics: Metric[]): Record<string, Metric[]> {
  const out: Record<string, Metric[]> = { gas: [], power: [], carbon: [], oil: [], other: [] };
  for (const m of metrics) {
    const g = GROUPS.find((b) => b.match(m.label.toLowerCase()));
    out[g ? g.key : 'other'].push(m);
  }
  return out;
}

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

// ── Customizable layout, persisted to localStorage (no auth needed) ──
const LS_KEY = 'comms.dashboard.layout.v2';
const WIDGETS: { id: string; title: string }[] = [
  { id: 'forward-curve', title: 'Forward curve & procurement timing' },
  { id: 'price-history', title: 'Price history' },
  { id: 'generation-map', title: 'Generation map' },
  { id: 'metrics-gas', title: 'Gas metrics' },
  { id: 'metrics-power', title: 'Power metrics' },
  { id: 'metrics-carbon', title: 'Carbon & grid metrics' },
  { id: 'metrics-oil', title: 'Oil & storage metrics' },
  { id: 'metrics-other', title: 'Other metrics' },
  { id: 'generation-mix', title: 'Generation mix' },
];
const DEFAULT_ORDER = WIDGETS.map((w) => w.id);
// Wide widgets (charts/maps) span the full grid; metric groups + the mix tile 2-up
// on a wide desktop so the dashboard uses the horizontal space instead of one column.
const FULL_WIDTH_WIDGETS = new Set(['forward-curve', 'price-history', 'generation-map']);

interface Layout { order: string[]; hidden: string[]; }

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Layout>;
      // Merge with the registry so widgets added in a later release still appear.
      const known = new Set(DEFAULT_ORDER);
      const order = [...(p.order ?? []).filter((id) => known.has(id))];
      // Surface widgets added in a later release without wiping the saved layout.
      // The flagship forward-curve widget leads; others append at the end.
      for (const id of DEFAULT_ORDER) if (!order.includes(id)) { if (id === 'forward-curve') order.unshift(id); else order.push(id); }
      return { order, hidden: (p.hidden ?? []).filter((id) => known.has(id)) };
    }
  } catch { /* fall through to default */ }
  return { order: DEFAULT_ORDER, hidden: [] };
}

export function Dashboard() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }, [layout]);

  const load = useCallback(() => {
    setRefreshing(true);
    return api.market()
      .then((d) => { setData(d); setErr(null); })
      .catch((e) => setErr(String(e.message)))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => (data ? groupMetrics(data.metrics) : null), [data]);

  if (err && !data) return <p className="text-sm text-up">Couldn’t load market data: {err}</p>;
  if (!data || !grouped) return <p className="text-sm text-brand-muted">Loading market data…</p>;

  const liveCount = data.metrics.filter((m) => m.sourceName !== 'Sample data').length;
  const mix = [...data.generationMix].sort((a, b) => b.pct - a.pct);
  const topFuel = mix[0];
  const maxPct = topFuel?.pct || 1;

  const metricsGroup = (key: string, title: string): ReactNode => {
    const items = grouped[key];
    if (!items?.length) return null;
    return (
      <section>
        <div className="label mb-2">{title}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((m) => <MetricCard key={m.id} m={m} />)}
        </div>
      </section>
    );
  };

  const renderWidget = (id: string): ReactNode => {
    switch (id) {
      case 'forward-curve': return <ForwardCurvePanel />;
      case 'price-history': return <PriceExplorer />;
      case 'generation-map': return <GenerationMap />;
      case 'metrics-gas': return metricsGroup('gas', 'Gas');
      case 'metrics-power': return metricsGroup('power', 'Power');
      case 'metrics-carbon': return metricsGroup('carbon', 'Carbon & grid');
      case 'metrics-oil': return metricsGroup('oil', 'Oil & storage');
      case 'metrics-other': return metricsGroup('other', 'Other');
      case 'generation-mix':
        return (
          <section className="card p-5">
            <div className="label mb-3">GB generation mix — transmission (now)</div>
            <div className="grid sm:grid-cols-[200px_1fr] gap-6 items-center">
              <div className="h-48 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mix} dataKey="pct" nameKey="fuel" innerRadius={54} outerRadius={80} paddingAngle={1.5} stroke="none" isAnimationActive={false}>
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
                      <div className="h-full rounded-full" style={{ width: `${(g.pct / maxPct) * 100}%`, background: FUEL_COLORS[i % FUEL_COLORS.length] }} />
                    </div>
                    <span className="font-mono text-brand-muted w-10 text-right shrink-0">{g.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      default: return null;
    }
  };

  // Customize panel actions
  const hidden = new Set(layout.hidden);
  // Decide add/remove from the updater's fresh state (not the render-time Set), so
  // rapid double-toggles can't push a duplicate id into the persisted layout.
  const toggle = (id: string) => setLayout((l) => ({ ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] }));
  const move = (id: string, dir: -1 | 1) => setLayout((l) => {
    const order = [...l.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return l;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...l, order };
  });
  const reset = () => setLayout({ order: DEFAULT_ORDER, hidden: [] });

  // Which widgets actually have content (so the panel doesn't list empty metric groups).
  const hasContent = (id: string): boolean => {
    if (id.startsWith('metrics-')) return (grouped[id.slice('metrics-'.length)] ?? []).length > 0;
    return true;
  };

  return (
    <div className="space-y-6">
      {/* Hero (fixed) */}
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
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right mr-1">
              <div className="label">As of</div>
              <div className="text-sm font-medium">{new Date(data.asOf).toLocaleString('en-GB')}</div>
            </div>
            <button className={'btn-ghost !px-2.5 !py-2 ' + (customizing ? '!border-brand-green !bg-brand-tint' : '')} onClick={() => setCustomizing((c) => !c)} title="Customize dashboard">
              <SlidersHorizontal size={15} />
            </button>
            <button className="btn-ghost !px-2.5 !py-2" onClick={load} disabled={refreshing} title="Refresh market data">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {customizing && (
          <div className="mt-4 pt-4 border-t border-brand-line">
            <div className="flex items-center gap-2 mb-2">
              <div className="label">Show, hide &amp; reorder widgets</div>
              <button className="text-xs text-brand-greenDark hover:underline inline-flex items-center gap-1 ml-auto" onClick={reset}>
                <RotateCcw size={12} /> Reset
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {layout.order.filter(hasContent).map((id) => {
                const w = WIDGETS.find((x) => x.id === id)!;
                const isHidden = hidden.has(id);
                return (
                  <div key={id} className="flex items-center gap-2 text-sm py-0.5">
                    <button onClick={() => toggle(id)} className={'shrink-0 ' + (isHidden ? 'text-brand-muted' : 'text-brand-greenDark')} title={isHidden ? 'Show' : 'Hide'}>
                      {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <span className={'flex-1 truncate ' + (isHidden ? 'text-brand-muted line-through' : '')}>{w.title}</span>
                    <button onClick={() => move(id, -1)} className="text-brand-muted hover:text-brand-ink shrink-0" title="Move up"><ChevronUp size={15} /></button>
                    <button onClick={() => move(id, 1)} className="text-brand-muted hover:text-brand-ink shrink-0" title="Move down"><ChevronDown size={15} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Customizable widgets — tile into a responsive grid on wide desktops. */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6 items-start">
        {layout.order.filter((id) => !hidden.has(id)).map((id) => {
          const node = renderWidget(id);
          return node ? (
            <div key={id} className={'min-w-0 ' + (FULL_WIDTH_WIDGETS.has(id) ? '2xl:col-span-2' : '')}>{node}</div>
          ) : null;
        })}
      </div>

      <footer className="text-xs text-brand-muted space-y-1">
        <div>Data as of {new Date(data.asOf).toLocaleString('en-GB')}.</div>
        {data.sources.filter((s) => s.attribution).map((s) => <div key={s.name}>{s.attribution}</div>)}
        <div className="italic">Indicative, for information only — not a price quotation.</div>
      </footer>
    </div>
  );
}
