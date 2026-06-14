import { useEffect, useState } from 'react';
import { LineChart as LineChartIcon, Loader2 } from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';
import { api, type PriceSeries, type RangeKey, type SeriesKey, type SeriesMeta } from '../lib/api';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: '12m', label: '12 months' },
];

const fmtTick = (t: string) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};
const fmtFull = (t: string) => {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtVal = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-[88px]">
      <div className="label">{label}</div>
      <div className={'font-mono text-sm font-semibold mt-0.5 ' + (tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-brand-ink')}>
        {value}
      </div>
    </div>
  );
}

// Detailed, interactive price history — series + range selectable, with summary
// stats for the chosen window. Backed by GET /api/market/history.
export function PriceExplorer() {
  const [seriesMeta, setSeriesMeta] = useState<SeriesMeta[]>([]);
  const [series, setSeries] = useState<SeriesKey>('gas');
  const [range, setRange] = useState<RangeKey>('6m');
  const [data, setData] = useState<PriceSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.marketSeries().then(setSeriesMeta).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    api.marketHistory(series, range)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error).message)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [series, range]);

  const pts = data?.points ?? [];
  const vals = pts.map((p) => p.v);
  const latest = vals.length ? vals[vals.length - 1] : null;
  const first = vals.length ? vals[0] : null;
  const changePct = latest != null && first ? ((latest - first) / first) * 100 : null;
  const high = vals.length ? Math.max(...vals) : null;
  const low = vals.length ? Math.min(...vals) : null;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const unit = data?.unit ?? '';

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-green/10 text-brand-greenDark">
          <LineChartIcon size={16} />
        </span>
        <div className="min-w-0 mr-2">
          <h3 className="text-sm font-semibold leading-tight">Price history</h3>
          <p className="text-[11px] text-brand-muted">Wholesale benchmarks over time</p>
        </div>

        <div className="flex gap-1">
          {(seriesMeta.length ? seriesMeta : [{ key: 'gas', label: 'Gas', unit: '' }, { key: 'power', label: 'Power', unit: '' }, { key: 'brent', label: 'Brent', unit: '' }] as SeriesMeta[]).map((s) => (
            <button
              key={s.key}
              onClick={() => setSeries(s.key)}
              className={'text-xs px-2.5 py-1.5 rounded-lg border transition ' +
                (series === s.key ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={'text-xs px-2.5 py-1.5 rounded-lg border transition ' +
                (range === r.key ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Window stats */}
      {pts.length > 1 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3">
          <Stat label="Latest" value={latest != null ? `${fmtVal(latest)} ${unit}` : '—'} />
          <Stat
            label={`Change (${range})`}
            value={changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%` : '—'}
            tone={changePct == null || Math.abs(changePct) < 0.1 ? undefined : changePct > 0 ? 'up' : 'down'}
          />
          <Stat label="High" value={high != null ? fmtVal(high) : '—'} />
          <Stat label="Low" value={low != null ? fmtVal(low) : '—'} />
          <Stat label="Average" value={avg != null ? fmtVal(avg) : '—'} />
        </div>
      )}

      <div className="h-72 relative">
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-white/60 z-10 rounded-lg">
            <Loader2 size={20} className="animate-spin text-brand-green" />
          </div>
        )}
        {err && <p className="text-sm text-up p-4">Couldn’t load price history: {err}</p>}
        {!err && pts.length > 1 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pts} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="explorer-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#40A800" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#40A800" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#E7E8E6" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={fmtTick}
                tick={{ fontSize: 11, fill: '#6B6A70' }}
                tickLine={false}
                axisLine={{ stroke: '#E7E8E6' }}
                minTickGap={48}
              />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={(v: number) => fmtVal(v)}
                tick={{ fontSize: 11, fill: '#6B6A70' }}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              {avg != null && <ReferenceLine y={avg} stroke="#6B6A70" strokeDasharray="4 4" strokeOpacity={0.5} />}
              <Tooltip
                formatter={(v: number) => [`${fmtVal(v)} ${unit}`, data?.label ?? '']}
                labelFormatter={fmtFull}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E7E8E6' }}
              />
              <Area type="monotone" dataKey="v" stroke="#40A800" strokeWidth={2} fill="url(#explorer-fill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!err && !loading && pts.length <= 1 && (
          <div className="h-full grid place-items-center text-sm text-brand-muted">Not enough history for this series yet.</div>
        )}
      </div>

      <div className="text-[11px] text-brand-muted mt-2">
        {data ? `${data.label} (${data.unit}) · Source: ${data.sourceName}.` : ''} Indicative, for information only — not a price quotation.
      </div>
    </section>
  );
}
