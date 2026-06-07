import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import type { Metric } from '../lib/api';

export function MetricCard({ m }: { m: Metric }) {
  const change = m.changePct ?? null;
  const up = (change ?? 0) >= 0;
  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="label">{m.label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="font-mono text-2xl font-semibold leading-none">
          {m.value ?? '—'}
          <span className="text-brand-muted text-xs font-sans ml-1">{m.unit}</span>
        </div>
        {change != null && (
          <div
            className={
              'flex items-center gap-0.5 text-xs font-medium ' + (up ? 'text-up' : 'text-down')
            }
          >
            {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {up ? '+' : ''}
            {change}%
          </div>
        )}
      </div>

      {m.series && m.series.length > 1 && (
        <div className="h-10 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={m.series} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
              <YAxis domain={['dataMin', 'dataMax']} hide />
              <Line type="monotone" dataKey="v" stroke="#40A800" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {m.meaning && <p className="text-xs text-brand-muted leading-snug">{m.meaning}</p>}
      <div className="text-[10px] text-brand-muted/70 mt-auto">{m.sourceName}</div>
    </div>
  );
}
