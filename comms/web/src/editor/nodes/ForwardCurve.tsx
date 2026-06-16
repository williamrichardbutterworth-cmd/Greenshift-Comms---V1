import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { TrendingDown } from 'lucide-react';
import { api, type ForwardCurveSnapshot } from '../../lib/api';
import { analyzeCurve, procurementNarrative, forwardCurveChartSVG, commodityLabel, legValue } from '../../lib/forwardCurve';
import { NodeShell } from '../NodeShell';

// Report block: the forward curve + the "procure now" argument. The latest
// snapshot is captured into the node's attrs on first load so the report is
// frozen/reproducible — the same invariant as the price-chart and grid-map nodes.

export const defaultForwardCurve = (): { snapshot: ForwardCurveSnapshot | null } => ({ snapshot: null });

function ForwardCurveView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const snapshot = node.attrs.snapshot as ForwardCurveSnapshot | null;
  const loaded = useRef(false);
  const [failed, setFailed] = useState(false);

  const fetchLatest = () => {
    setFailed(false);
    api.forwardCurve.latest().then((s) => { if (s) updateAttributes({ snapshot: s }); else { loaded.current = false; setFailed(true); } })
      .catch(() => { loaded.current = false; setFailed(true); });
  };

  useEffect(() => {
    if (snapshot || loaded.current) return;
    loaded.current = true;
    fetchLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  return (
    <NodeShell label="Forward curve & procurement timing" icon={TrendingDown} selected={selected} onDelete={deleteNode}>
      {snapshot ? (
        <div className="space-y-4">
          {snapshot.curves.map((curve) => {
            const a = analyzeCurve(curve);
            return (
              <div key={curve.commodity} className="space-y-1.5">
                <div className="text-sm font-semibold">{commodityLabel(curve.commodity)} <span className="text-brand-muted font-normal">({curve.unit})</span></div>
                {a && <p className="text-[13px] leading-snug text-brand-ink">{procurementNarrative(curve, a)}</p>}
                <div className="rounded-lg overflow-hidden border border-brand-line [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: forwardCurveChartSVG(curve, { width: 700, height: 260 }) }} />
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-brand-muted">
                      <th className="text-left font-medium py-0.5">Contract</th>
                      <th className="text-right font-medium py-0.5">Latest</th>
                      <th className="text-right font-medium py-0.5">Current</th>
                    </tr>
                  </thead>
                  <tbody>
                    {curve.legs.map((l, i) => (
                      <tr key={i} className={'border-t border-brand-line/60 ' + (a && a.hasForwardValue && l === a.cheapest ? 'text-brand-greenDark font-medium' : '')}>
                        <td className="py-0.5">{l.label}</td>
                        <td className="py-0.5 text-right font-mono">{l.latest ?? '—'}</td>
                        <td className="py-0.5 text-right font-mono">{l.current ?? legValue(l) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <p className="text-[11px] text-brand-muted">
            {snapshot.source} · report {new Date(snapshot.asOfDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. Indicative market levels, for information only — not a price quotation.
          </p>
        </div>
      ) : failed ? (
        <div className="h-32 grid place-items-center text-sm text-brand-muted gap-2">
          No market data captured yet — add today’s report on the Dashboard.
          <button className="btn-ghost !py-1 text-xs" onClick={() => { loaded.current = true; fetchLatest(); }}>Retry</button>
        </div>
      ) : (
        <div className="h-32 grid place-items-center text-sm text-brand-muted">Loading forward curve…</div>
      )}
    </NodeShell>
  );
}

export const ForwardCurve = Node.create({
  name: 'forwardCurve',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { snapshot: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="forward-curve"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'forward-curve' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ForwardCurveView);
  },
});
