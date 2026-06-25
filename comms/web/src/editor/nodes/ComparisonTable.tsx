import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { Table2, Plus, Trash2, Star } from 'lucide-react';
import type { ComparisonTableData, ComparisonRow } from '../../lib/api';
import { NodeShell } from '../NodeShell';

export const defaultComparison = (): ComparisonTableData => ({
  rows: [
    { option: 'Supplier A', unitRate: '', standingCharge: '', term: '', annualCost: '', green: false, recommended: true },
    { option: 'Supplier B', unitRate: '', standingCharge: '', term: '', annualCost: '', green: false, recommended: false },
  ],
});

const COLS: { key: keyof ComparisonRow; label: string; placeholder: string }[] = [
  { key: 'option', label: 'Option', placeholder: 'Supplier / option' },
  { key: 'unitRate', label: 'Unit rate', placeholder: 'p/kWh' },
  { key: 'standingCharge', label: 'Standing chg', placeholder: 'p/day' },
  { key: 'term', label: 'Term', placeholder: '24m' },
  { key: 'annualCost', label: 'Annual cost', placeholder: '£' },
];

function ComparisonTableView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const data = (node.attrs.data as ComparisonTableData) ?? defaultComparison();
  const setRows = (rows: ComparisonRow[]) => updateAttributes({ data: { ...data, rows } });
  const setCell = (i: number, key: keyof ComparisonRow, v: string | boolean) =>
    setRows(data.rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  // Only one row can be the recommended option.
  const setRecommended = (i: number) => setRows(data.rows.map((r, idx) => ({ ...r, recommended: idx === i })));
  const addRow = () => setRows([...data.rows, { option: `Supplier ${String.fromCharCode(65 + data.rows.length)}`, unitRate: '', standingCharge: '', term: '', annualCost: '', green: false, recommended: false }]);
  const removeRow = (i: number) => {
    const next = data.rows.filter((_, idx) => idx !== i);
    // Keep exactly one recommended option if the starred row was removed.
    if (next.length && !next.some((r) => r.recommended)) next[0] = { ...next[0], recommended: true };
    setRows(next);
  };

  return (
    <NodeShell label="Quote comparison" icon={Table2} selected={selected} onDelete={deleteNode}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-brand-muted">
              {COLS.map((c) => <th key={c.key} className="text-left font-medium py-1 px-1.5">{c.label}</th>)}
              <th className="font-medium py-1 px-1.5 text-center">Green</th>
              <th className="font-medium py-1 px-1.5 text-center">Pick</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className={'border-t border-brand-line ' + (r.recommended ? 'bg-brand-tint' : '')}>
                {COLS.map((c) => (
                  <td key={c.key} className="py-0.5 px-1">
                    <input
                      className={'input !py-1 !px-2 text-sm ' + (c.key === 'option' ? 'min-w-[120px] font-medium' : 'w-20 font-mono')}
                      value={(r[c.key] as string) ?? ''}
                      placeholder={c.placeholder}
                      onChange={(e) => setCell(i, c.key, e.target.value)}
                    />
                  </td>
                ))}
                <td className="py-0.5 px-1.5 text-center">
                  <input type="checkbox" className="accent-brand-green" checked={!!r.green} onChange={(e) => setCell(i, 'green', e.target.checked)} title="Green / renewable" />
                </td>
                <td className="py-0.5 px-1.5 text-center">
                  <button onClick={() => setRecommended(i)} title="Mark as the recommended option" className={r.recommended ? 'text-brand-green' : 'text-brand-line hover:text-brand-muted'}>
                    <Star size={15} fill={r.recommended ? 'currentColor' : 'none'} />
                  </button>
                </td>
                <td className="py-0.5">
                  <button className="p-1 text-brand-muted hover:text-up" onClick={() => removeRow(i)} title="Remove row"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-ghost !py-1 text-sm mt-2" onClick={addRow}><Plus size={14} /> Add option</button>
      <input
        className="input !py-1 text-sm mt-2"
        value={data.caption ?? ''}
        placeholder="Caption (optional) — e.g. all figures exclude VAT, based on 450,000 kWh/yr"
        onChange={(e) => updateAttributes({ data: { ...data, caption: e.target.value } })}
      />
    </NodeShell>
  );
}

export const ComparisonTable = Node.create({
  name: 'comparisonTable',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { data: { default: defaultComparison() } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="comparison-table"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'comparison-table' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ComparisonTableView);
  },
});
