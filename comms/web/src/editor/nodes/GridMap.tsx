import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { api, type GridSnapshot } from '../../lib/api';
import { renderGridMapSVG } from '../../lib/gridMapSvg';
import { NodeShell } from '../NodeShell';

// Report block: the UK generation map. The grid snapshot is captured into the
// node's attrs the first time it loads, so the report is frozen/reproducible
// (the same invariant as the price-chart node storing its points).

export const defaultGridMap = (): { snapshot: GridSnapshot | null; mode: 'intensity' | 'fuel' } => ({
  snapshot: null,
  mode: 'intensity',
});

function GridMapView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const snapshot = node.attrs.snapshot as GridSnapshot | null;
  const mode = (node.attrs.mode as 'intensity' | 'fuel') ?? 'intensity';
  const loaded = useRef(false);
  const [failed, setFailed] = useState(false);

  const fetchGrid = () => {
    setFailed(false);
    api.grid().then((g) => updateAttributes({ snapshot: g })).catch(() => { loaded.current = false; setFailed(true); });
  };

  useEffect(() => {
    if (snapshot || loaded.current) return;
    loaded.current = true;
    fetchGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  const netImport = snapshot ? snapshot.interconnectors.reduce((a, i) => a + i.mw, 0) : 0;

  return (
    <NodeShell
      label="Generation map"
      icon={MapIcon}
      selected={selected}
      onDelete={deleteNode}
      actions={
        <div className="inline-flex rounded-md border border-brand-line overflow-hidden text-xs mr-1">
          {(['intensity', 'fuel'] as const).map((m) => (
            <button
              key={m}
              className={'px-2 py-0.5 capitalize ' + (mode === m ? 'bg-brand-green text-white' : 'bg-white text-brand-muted hover:bg-brand-tint')}
              onClick={() => updateAttributes({ mode: m })}
            >
              {m === 'intensity' ? 'Carbon' : 'Fuel'}
            </button>
          ))}
        </div>
      }
    >
      {snapshot ? (
        <div className="space-y-2">
          <div className="rounded-lg overflow-hidden border border-brand-line" dangerouslySetInnerHTML={{ __html: renderGridMapSVG({ regions: snapshot.regions, mode, width: 460 }) }} />
          {snapshot.interconnectors.length > 0 && (
            <p className="text-xs text-brand-muted">
              Net interconnector {netImport >= 0 ? 'import' : 'export'} {Math.abs(netImport).toLocaleString('en-GB')} MW ·{' '}
              {snapshot.interconnectors.slice(0, 3).map((i) => `${i.name} ${Math.abs(i.mw).toLocaleString('en-GB')}MW`).join(', ')}
            </p>
          )}
          <p className="text-[11px] text-brand-muted">
            Estimated regional carbon intensity (NESO model). As of {new Date(snapshot.asOf).toLocaleString('en-GB')}.{' '}
            {snapshot.sources.map((s) => s.attribution).filter(Boolean).join(' ')}
          </p>
        </div>
      ) : failed ? (
        <div className="h-40 grid place-items-center text-sm text-brand-muted gap-2">
          Grid data unavailable.
          <button className="btn-ghost !py-1 text-xs" onClick={() => { loaded.current = true; fetchGrid(); }}>Retry</button>
        </div>
      ) : (
        <div className="h-40 grid place-items-center text-sm text-brand-muted">Loading grid map…</div>
      )}
    </NodeShell>
  );
}

export const GridMap = Node.create({
  name: 'gridMap',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { snapshot: { default: null }, mode: { default: 'intensity' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="grid-map"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'grid-map' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(GridMapView);
  },
});
