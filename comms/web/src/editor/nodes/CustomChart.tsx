import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { Fragment, useState } from 'react';
import { BarChart3, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api, type CustomChartData, type CustomChartPoint } from '../../lib/api';
import { NodeShell } from '../NodeShell';

export const defaultCustomChart = (): CustomChartData => ({
  title: 'Custom chart',
  unit: '',
  kind: 'bar',
  points: [
    { label: 'Q1', value: 0 },
    { label: 'Q2', value: 0 },
  ],
});

function CustomChartView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const data = node.attrs.data as CustomChartData;
  const patch = (p: Partial<CustomChartData>) => updateAttributes({ data: { ...data, ...p } });
  const setPoints = (points: CustomChartPoint[]) => patch({ points });

  const setRow = (i: number, key: keyof CustomChartPoint, raw: string) => {
    const next = data.points.slice();
    next[i] = { ...next[i], [key]: key === 'value' ? (raw === '' ? 0 : Number(raw)) : raw };
    setPoints(next);
  };
  const addRow = () => setPoints([...data.points, { label: `Item ${data.points.length + 1}`, value: 0 }]);
  const removeRow = (i: number) => setPoints(data.points.filter((_, idx) => idx !== i));

  const chartData = data.points.filter((p) => p.label !== '' && Number.isFinite(p.value));

  const [analysing, setAnalysing] = useState(false);
  const analyse = async () => {
    if (!chartData.length) return;
    setAnalysing(true);
    try {
      const summary = `${data.title}${data.unit ? ` (${data.unit})` : ''}: ` + chartData.map((p) => `${p.label}=${p.value}`).join(', ');
      const res = await api.editReport('analyseChart', summary);
      if (!res.error && res.text) patch({ caption: res.text });
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <NodeShell label="Custom chart" icon={BarChart3} selected={selected} onDelete={deleteNode}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="input !py-1 !w-auto text-sm font-medium flex-1 min-w-[140px]"
            value={data.title}
            placeholder="Chart title"
            onChange={(e) => patch({ title: e.target.value })}
          />
          <input
            className="input !py-1 !w-24 text-sm"
            value={data.unit}
            placeholder="Unit"
            onChange={(e) => patch({ unit: e.target.value })}
          />
          <div className="inline-flex rounded-lg border border-brand-line overflow-hidden text-sm">
            {(['bar', 'line'] as const).map((k) => (
              <button
                key={k}
                className={'px-2.5 py-1 capitalize ' + (data.kind === k ? 'bg-brand-green text-white' : 'bg-white text-brand-muted hover:bg-brand-tint')}
                onClick={() => patch({ kind: k })}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
          <span className="label">Label</span>
          <span className="label">Value</span>
          <span />
          {data.points.map((p, i) => (
            <Fragment key={i}>
              <input className="input !py-1 text-sm" value={p.label} onChange={(e) => setRow(i, 'label', e.target.value)} />
              <input
                className="input !py-1 text-sm font-mono"
                type="number"
                value={String(p.value)}
                onChange={(e) => setRow(i, 'value', e.target.value)}
              />
              <button className="btn-ghost !px-1.5 !py-1 hover:text-up" onClick={() => removeRow(i)} title="Remove row">
                <Trash2 size={14} />
              </button>
            </Fragment>
          ))}
        </div>
        <button className="btn-ghost !py-1 text-sm" onClick={addRow}><Plus size={14} /> Add row</button>

        <div className="h-52 rounded-lg border border-brand-line p-2">
          {chartData.length >= 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              {data.kind === 'line' ? (
                <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="value" stroke="#40A800" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" fill="#40A800" radius={[3, 3, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="h-full grid place-items-center text-sm text-brand-muted">Add data rows to build the chart.</div>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <input
            className="input !py-1 text-sm flex-1"
            value={data.caption ?? ''}
            placeholder="Caption (optional) — what does this chart show?"
            onChange={(e) => patch({ caption: e.target.value })}
          />
          <button
            className="btn-ghost !py-1 text-sm shrink-0"
            onClick={analyse}
            disabled={analysing || !chartData.length}
            title="Let AI write a one-line caption from your data"
          >
            {analysing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Analyse
          </button>
        </div>
      </div>
    </NodeShell>
  );
}

export const CustomChart = Node.create({
  name: 'customChart',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { data: { default: defaultCustomChart() } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="custom-chart"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'custom-chart' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CustomChartView);
  },
});
