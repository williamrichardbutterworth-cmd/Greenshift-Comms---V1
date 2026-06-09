import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import type { Metric } from '../lib/api';

// Large, readable value: thousands separators, original precision preserved.
function fmtValue(v: number | null): string {
  if (v == null) return '—';
  const decimals = Number.isInteger(v) ? 0 : String(v).split('.')[1]?.length ?? 0;
  return v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function MetricCard({ m }: { m: Metric }) {
  const change = m.changePct ?? null;
  const flat = change != null && Math.abs(change) < 0.1;
  const up = (change ?? 0) >= 0;
  const tone = flat ? 'text-brand-muted bg-brand-line/50' : up ? 'text-up bg-up/10' : 'text-down bg-down/10';
  const gradId = `spark-${m.id}`;
  const live = m.sourceName !== 'Sample data';

  return (
    <div className="card p-4 flex flex-col gap-2.5 transition hover:shadow-md hover:-translate-y-px">
      <div className="flex items-start justify-between gap-2">
        <div className="label leading-tight">{m.label}</div>
        {change != null && (
          <div
            title="Change vs previous reading"
            className={'shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ' + tone}
          >
            {flat ? <Minus size={12} /> : up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {!flat && (up ? '+' : '')}{change}%
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[32px] font-semibold leading-none tracking-tight">{fmtValue(m.value)}</span>
        <span className="text-brand-muted text-sm">{m.unit}</span>
      </div>

      {m.series && m.series.length > 1 && (
        <div className="h-12 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.series} margin={{ top: 4, bottom: 2, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#40A800" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#40A800" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Tooltip
                formatter={(v: number) => [`${fmtValue(v)} ${m.unit}`, m.label]}
                labelFormatter={() => ''}
                contentStyle={{ fontSize: 11, borderRadius: 8, padding: '4px 8px', border: '1px solid #E7E8E6' }}
              />
              <Area type="monotone" dataKey="v" stroke="#40A800" strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {m.meaning && <p className="text-xs text-brand-muted leading-snug">{m.meaning}</p>}
      <div className="flex items-center gap-1.5 text-[10px] text-brand-muted/70 mt-auto pt-0.5">
        <span className={'h-1.5 w-1.5 rounded-full ' + (live ? 'bg-brand-green' : 'bg-brand-line')} title={live ? 'Live source' : 'Sample data'} />
        {m.sourceName}
      </div>
    </div>
  );
}
