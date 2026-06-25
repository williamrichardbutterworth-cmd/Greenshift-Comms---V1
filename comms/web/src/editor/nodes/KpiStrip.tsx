import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Gauge, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { api, type KpiStripData, type KpiCard, type Metric, type ForwardCurveSnapshot } from '../../lib/api';
import { analyzeCurve, curveSignal, commodityLabel } from '../../lib/forwardCurve';
import { NodeShell } from '../NodeShell';

export const defaultKpiStrip = (): KpiStripData => ({ cards: [] });

const fmtNum = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 });

// Build up to 4 headline cards from the live market snapshot + the forward
// curve. Lead card is the forward discount (later season vs front) when the
// curve is backwardated, else the day-ahead power price. Returns a `note` when a
// modelled forward figure is present, so the caption can flag it as such (the
// "Buy-ahead saving" framing overstated a modelled gap as a realised saving).
export function buildKpiCards(metrics: Metric[], fc: ForwardCurveSnapshot | null): { cards: KpiCard[]; note?: string } {
  const cards: KpiCard[] = [];
  let note: string | undefined;
  if (fc) {
    for (const curve of fc.curves) {
      const a = analyzeCurve(curve);
      if (a && curveSignal(a) === 'backwardation' && a.savingPct > 0) {
        cards.push({ label: `Forward discount · ${commodityLabel(curve.commodity)}`, value: `${a.savingPct}%`, unit: `${a.cheapest.label} vs ${a.front.label}`, tone: 'accent' });
        note = 'Forward figures are modelled curve levels (later season vs front), not a guaranteed saving.';
        break;
      }
    }
  }
  const pick = (re: RegExp, unitRe: RegExp) => metrics.find((m) => re.test(m.label) && unitRe.test(m.unit) && m.value != null);
  const power = pick(/power|electric/i, /mwh/i);
  if (power) cards.push({ label: power.label, value: fmtNum(power.value), unit: power.unit, delta: power.changePct ?? null });
  const gas = pick(/gas/i, /therm/i);
  if (gas) cards.push({ label: gas.label, value: fmtNum(gas.value), unit: gas.unit, delta: gas.changePct ?? null });
  const brent = metrics.find((m) => /brent/i.test(m.label) && /\$|bbl|usd/i.test(m.unit) && m.value != null);
  if (brent) cards.push({ label: brent.label, value: fmtNum(brent.value), unit: brent.unit, delta: brent.changePct ?? null });
  if (!cards.length) for (const m of metrics.slice(0, 3)) cards.push({ label: m.label, value: fmtNum(m.value), unit: m.unit, delta: m.changePct ?? null });
  const out = cards.slice(0, 4);
  if (out.length && !out.some((c) => c.tone === 'accent')) out[0].tone = 'accent';
  return { cards: out, note };
}

function Delta({ d }: { d?: number | null }) {
  if (d == null) return null;
  const flat = Math.abs(d) < 0.1;
  const up = d >= 0;
  return (
    <span className={'inline-flex items-center gap-0.5 text-xs font-semibold ' + (flat ? 'text-brand-muted' : up ? 'text-up' : 'text-down')}>
      {flat ? <Minus size={11} /> : up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{!flat && up ? '+' : ''}{flat ? '' : d}%
    </span>
  );
}

function KpiStripView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const data = (node.attrs.data as KpiStripData) ?? defaultKpiStrip();
  const loaded = useRef(false);
  const [failed, setFailed] = useState(false);

  const fetchData = () => {
    setFailed(false);
    Promise.all([
      api.market().then((m) => m.metrics).catch(() => [] as Metric[]),
      api.forwardCurve.latest().catch(() => null),
    ]).then(([metrics, fc]) => {
      const { cards, note } = buildKpiCards(metrics, fc);
      if (cards.length) updateAttributes({ data: { cards, note, asOf: new Date().toISOString() } });
      else { loaded.current = false; setFailed(true); }
    }).catch(() => { loaded.current = false; setFailed(true); });
  };

  useEffect(() => {
    if (data.cards.length || loaded.current) return;
    loaded.current = true;
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cards.length]);

  return (
    <NodeShell label="At a glance" icon={Gauge} selected={selected} onDelete={deleteNode}>
      {data.cards.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {data.cards.map((c, i) => (
            <div key={i} className={'rounded-lg border p-3 ' + (c.tone === 'accent' ? 'border-brand-green bg-brand-tint' : 'border-brand-line bg-white')}>
              <div className="text-[10px] uppercase tracking-wide text-brand-muted leading-tight line-clamp-2 min-h-[24px]">{c.label}</div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className={'font-mono text-xl font-semibold leading-none ' + (c.tone === 'accent' ? 'text-brand-greenDark' : 'text-brand-ink')}>{c.value}</span>
                {c.unit && <span className="text-[10px] text-brand-muted">{c.unit}</span>}
              </div>
              <div className="mt-1"><Delta d={c.delta} /></div>
            </div>
          ))}
        </div>
      ) : failed ? (
        <div className="h-20 grid place-items-center text-sm text-brand-muted gap-1">
          Market data unavailable.
          <button className="btn-ghost !py-1 text-xs" onClick={() => { loaded.current = true; fetchData(); }}>Retry</button>
        </div>
      ) : (
        <div className="h-20 grid place-items-center text-sm text-brand-muted">Loading headline numbers…</div>
      )}
    </NodeShell>
  );
}

export const KpiStrip = Node.create({
  name: 'kpiStrip',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { data: { default: defaultKpiStrip() } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="kpi-strip"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'kpi-strip' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(KpiStripView);
  },
});
