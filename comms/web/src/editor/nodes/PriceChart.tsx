import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { LineChart as LineChartIcon } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api, type ChartData, type SeriesMeta, type SeriesKey, type RangeKey } from '../../lib/api';
import { NodeShell } from '../NodeShell';

const RANGES: { k: RangeKey; label: string }[] = [
  { k: '3m', label: '3 months' },
  { k: '6m', label: '6 months' },
  { k: '12m', label: '12 months' },
];

export const defaultChart = (): ChartData => ({
  series: 'brent', label: 'Brent crude', unit: '$/bbl', range: '12m', points: [],
});

function PriceChartView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const chart = node.attrs.chart as ChartData;
  const [seriesMeta, setSeriesMeta] = useState<SeriesMeta[]>([]);
  const loadedFor = useRef<string>('');

  useEffect(() => {
    api.marketSeries().then(setSeriesMeta).catch(() => setSeriesMeta([]));
  }, []);

  const load = async (series: SeriesKey, range: RangeKey) => {
    try {
      const h = await api.marketHistory(series, range);
      updateAttributes({
        chart: { series: h.key, label: h.label, unit: h.unit, range: h.range, points: h.points, sourceName: h.sourceName },
      });
    } catch {
      /* leave existing points; preview shows the loading state */
    }
  };

  // Fill points on first mount if the chart was inserted/assembled empty.
  useEffect(() => {
    const key = `${chart.series}:${chart.range}`;
    if (chart.points.length < 2 && loadedFor.current !== key) {
      loadedFor.current = key;
      void load(chart.series, chart.range);
    }
  }, [chart.series, chart.range, chart.points.length]);

  const options = seriesMeta.length ? seriesMeta : [{ key: chart.series, label: chart.label, unit: chart.unit }];

  return (
    <NodeShell label="Price chart" icon={LineChartIcon} selected={selected} onDelete={deleteNode}>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <select
            className="input !py-1 !w-auto text-sm"
            value={chart.series}
            onChange={(e) => load(e.target.value as SeriesKey, chart.range)}
          >
            {options.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select
            className="input !py-1 !w-auto text-sm"
            value={chart.range}
            onChange={(e) => load(chart.series, e.target.value as RangeKey)}
          >
            {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
          </select>
        </div>
        <div className="h-48 rounded-lg border border-brand-line p-2">
          {chart.points.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={48} tickFormatter={(t) => String(t).slice(2, 7)} />
                <YAxis tick={{ fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="v" stroke="#40A800" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full grid place-items-center text-sm text-brand-muted">Loading chart…</div>
          )}
        </div>
        {chart.points.length > 1 && (
          <p className="text-xs text-brand-muted">
            {chart.label} ({chart.unit}) · {chart.points[0].t} → {chart.points[chart.points.length - 1].t} · Source: {chart.sourceName}
          </p>
        )}
      </div>
    </NodeShell>
  );
}

export const PriceChart = Node.create({
  name: 'priceChart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { chart: { default: defaultChart() } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="price-chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'price-chart' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PriceChartView);
  },
});
