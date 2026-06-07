import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { Table2 } from 'lucide-react';
import { api, type MarketSnapshot, type Metric, type MetricRow } from '../../lib/api';
import { NodeShell } from '../NodeShell';

// Embedded "market metrics" table. Rows are frozen into the node's attrs at
// insert time (so the figure is fixed at the moment of drafting); the live
// snapshot is fetched only to offer the toggle checkboxes.

export const metricToRow = (m: Metric): MetricRow => ({
  label: m.label, value: m.value, unit: m.unit, changePct: m.changePct,
});

function MetricsTableView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const rows = ((node.attrs.rows as MetricRow[] | null) ?? []) as MetricRow[];
  const asOf = node.attrs.asOf as string | undefined;
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);

  useEffect(() => {
    api.market().then(setSnapshot).catch(() => setSnapshot(null));
  }, []);

  const toggleMetric = (label: string) => {
    if (!snapshot) return;
    const has = rows.some((r) => r.label === label);
    let next = has
      ? rows.filter((r) => r.label !== label)
      : [...rows, metricToRow(snapshot.metrics.find((m) => m.label === label)!)];
    const order = new Map(snapshot.metrics.map((m, i) => [m.label, i] as const));
    next = next.slice().sort((a, b) => (order.get(a.label) ?? 0) - (order.get(b.label) ?? 0));
    updateAttributes({ rows: next, asOf: asOf ?? new Date(snapshot.asOf).toLocaleString('en-GB') });
  };

  return (
    <NodeShell label="Market metrics" icon={Table2} selected={selected} onDelete={deleteNode}>
      <div className="space-y-2">
        {snapshot && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {snapshot.metrics.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-brand-green"
                  checked={rows.some((r) => r.label === m.label)}
                  onChange={() => toggleMetric(m.label)}
                />
                {m.label}
              </label>
            ))}
          </div>
        )}
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-brand-line/60">
                <td className="py-1">{r.label}</td>
                <td className="py-1 text-right font-mono">
                  {r.value ?? '—'} <span className="text-brand-muted text-xs">{r.unit}</span>
                </td>
                <td className={'py-1 text-right font-mono text-xs ' + ((r.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                  {r.changePct == null ? '' : (r.changePct > 0 ? '+' : '') + r.changePct + '%'}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td className="py-2 text-brand-muted text-xs">No metrics selected — tick a metric above.</td></tr>
            )}
          </tbody>
        </table>
        {asOf && <p className="text-[11px] text-brand-muted italic">Indicative market data, as of {asOf}.</p>}
      </div>
    </NodeShell>
  );
}

export const MetricsTable = Node.create({
  name: 'metricsTable',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      rows: { default: [] as MetricRow[] },
      asOf: { default: undefined as string | undefined },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="metrics-table"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'metrics-table' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MetricsTableView);
  },
});
