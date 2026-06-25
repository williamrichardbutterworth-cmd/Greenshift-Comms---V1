import { useCallback, useEffect, useState } from 'react';
import { TrendingDown, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Pencil, LineChart, Info } from 'lucide-react';
import { api, type ForwardCurveSnapshot, type CommodityCurve, type Commodity, type Metric, type ForwardTrend } from '../lib/api';
import {
  analyzeCurve, backwardationHeadline, commodityLabel, fmtPrice, forwardCurveChartSVG, isSeasonLabel, curveSignal,
} from '../lib/forwardCurve';
import { renderLineChartSVG } from '../lib/chartSvg';
import { ForwardCurveIntake } from './ForwardCurveIntake';

function Delta({ from, to }: { from: number | null; to: number | null }) {
  if (from == null || to == null) return <span className="text-brand-muted">—</span>;
  const d = Math.round((to - from) * 100) / 100;
  const flat = Math.abs(d) < 0.005;
  const up = d >= 0;
  return (
    <span className={'inline-flex items-center gap-0.5 font-mono ' + (flat ? 'text-brand-muted' : up ? 'text-up' : 'text-down')}>
      {flat ? <Minus size={11} /> : up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {!flat && up ? '+' : ''}{d}
    </span>
  );
}

function pickLive(metrics: Metric[], commodity: Commodity): Metric | null {
  const inUnit = commodity === 'power' ? /mwh/i : /therm/i;
  const inLabel = commodity === 'power' ? /power|electric/i : /gas/i;
  return metrics.find((m) => inUnit.test(m.unit) && inLabel.test(m.label) && m.value != null && m.sourceName !== 'Sample data')
    ?? metrics.find((m) => inUnit.test(m.unit) && inLabel.test(m.label) && m.value != null)
    ?? null;
}

function CurveBlock({ curve, live, trend }: { curve: CommodityCurve; live: Metric | null; trend: ForwardTrend | null }) {
  const a = analyzeCurve(curve);
  const signal = a ? curveSignal(a) : 'contango';
  const positive = signal !== 'contango';
  const da = curve.legs.find((l) => /^da$/i.test(l.label));
  const reportFront = da ? (da.current ?? da.latest) : null;
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{commodityLabel(curve.commodity)}</span>
        <span className="text-[11px] text-brand-muted">{curve.unit}</span>
      </div>

      {/* Procurement-timing callout — chrome and text both driven by the signal */}
      {a && (
        <div className={'flex items-start gap-2 rounded-lg p-2.5 mb-3 text-sm ' + (positive ? 'bg-brand-tint text-brand-ink' : 'bg-brand-line/40 text-brand-ink')}>
          {positive ? <TrendingDown size={16} className="text-brand-greenDark shrink-0 mt-0.5" /> : <Info size={16} className="text-brand-muted shrink-0 mt-0.5" />}
          <div>
            {positive && a.savingPct > 0 && (
              <div className="font-semibold text-brand-greenDark leading-tight">{a.cheapest.label} is {a.savingPct}% below {a.front.label}</div>
            )}
            <p className="text-[13px] leading-snug text-brand-muted mt-0.5">{backwardationHeadline(curve, a)}</p>
          </div>
        </div>
      )}

      {/* Forward curve chart */}
      <div className="[&_svg]:w-full [&_svg]:h-auto -mx-1" dangerouslySetInnerHTML={{ __html: forwardCurveChartSVG(curve, { width: 720, height: 230 }) }} />

      {/* Season table */}
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-brand-muted border-b border-brand-line">
              <th className="text-left font-medium py-1.5 pr-2">Contract</th>
              <th className="text-right font-medium py-1.5 px-2">Latest</th>
              <th className="text-right font-medium py-1.5 px-2">Prev</th>
              <th className="text-right font-medium py-1.5 px-2 hidden sm:table-cell">Δ</th>
              <th className="text-right font-medium py-1.5 px-2">Current</th>
            </tr>
          </thead>
          <tbody>
            {curve.legs.map((l, i) => {
              const isCheapest = a && a.hasForwardValue && l === a.cheapest;
              return (
                <tr key={i} className={'border-b border-brand-line/60 ' + (isCheapest ? 'bg-brand-tint/60' : '')}>
                  <td className="py-1 pr-2 font-medium">
                    {l.label}
                    {isCheapest && <span className="ml-1.5 text-[9px] uppercase tracking-wide text-brand-greenDark bg-brand-green/10 px-1 rounded">cheapest</span>}
                    {isSeasonLabel(l.label) && !isCheapest && <span className="ml-1 text-[9px] text-brand-muted">season</span>}
                  </td>
                  <td className="py-1 px-2 text-right font-mono">{l.latest ?? '—'}</td>
                  <td className="py-1 px-2 text-right font-mono text-brand-muted">{l.prev ?? '—'}</td>
                  <td className="py-1 px-2 text-right hidden sm:table-cell"><Delta from={l.prev} to={l.latest} /></td>
                  <td className="py-1 px-2 text-right font-mono font-semibold">{l.current ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Live keyless cross-check */}
      {live && (
        <p className="text-[11px] text-brand-muted mt-2 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
          Live cross-check: {fmtPrice(live.value, curve.unit)} ({live.sourceName})
          {reportFront != null && <span>· report day-ahead {fmtPrice(reportFront, curve.unit)}</span>}
        </p>
      )}

      {/* Self-built front-of-curve trend (grows daily from saved snapshots) */}
      {trend && trend.points.length >= 2 && (
        <div className="mt-3 pt-3 border-t border-brand-line">
          <div className="label mb-1">Day-ahead trend — built from your saved snapshots</div>
          <div className="[&_svg]:w-full [&_svg]:h-auto -mx-1" dangerouslySetInnerHTML={{ __html: renderLineChartSVG({ points: trend.points, title: `${commodityLabel(curve.commodity)} day-ahead`, unit: trend.unit, width: 720, height: 180 }) }} />
        </div>
      )}
    </div>
  );
}

// The hero: the daily forward curve, its backwardation read, the live keyless
// cross-check and a self-built price trend. The "procure now" pillar.
export function ForwardCurvePanel() {
  const [snap, setSnap] = useState<ForwardCurveSnapshot | null | undefined>(undefined);
  const [live, setLive] = useState<Metric[]>([]);
  const [trends, setTrends] = useState<Record<Commodity, ForwardTrend | null>>({ power: null, gas: null });
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    api.market().then((d) => setLive(d.metrics)).catch(() => {});
    return api.forwardCurve.latest()
      .then((s) => setSnap(s))
      .catch(() => setSnap(null))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!snap) return;
    api.forwardCurve.trend('power').then((t) => setTrends((s) => ({ ...s, power: t }))).catch(() => {});
    api.forwardCurve.trend('gas').then((t) => setTrends((s) => ({ ...s, gas: t }))).catch(() => {});
  }, [snap?.id]);

  const intake = editing ? (
    <ForwardCurveIntake
      onSaved={(s) => { setEditing(false); setSnap(s); }}
      onCancel={() => setEditing(false)}
    />
  ) : null;

  if (snap === undefined) return <section className="card p-5"><p className="text-sm text-brand-muted">Loading forward curve…</p></section>;

  if (!snap) {
    return (
      <section className="card p-8 text-center">
        {intake}
        <LineChart size={28} className="mx-auto mb-3 text-brand-green opacity-70" />
        <h3 className="text-base font-semibold">Forward curve &amp; procurement timing</h3>
        <p className="text-sm text-brand-muted mt-1 mb-4 max-w-md mx-auto">
          Capture this morning’s market report — paste it or drop a screenshot. We’ll read the UK power baseload and NBP gas forward curves and show, in one view, whether buying ahead is cheaper.
        </p>
        <button className="btn-primary mx-auto" onClick={() => setEditing(true)}><LineChart size={16} /> Add today’s market data</button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {intake}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="grid place-items-center h-7 w-7 rounded-lg bg-brand-green/10 text-brand-greenDark"><TrendingDown size={15} /></span>
            Forward curve &amp; procurement timing
          </h2>
          <p className="text-sm text-brand-muted mt-0.5">
            {snap.source} · report {new Date(snap.asOfDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button className="btn-ghost !py-2 !px-2.5" onClick={load} disabled={refreshing} title="Refresh"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></button>
        <button className="btn-primary !py-2" onClick={() => setEditing(true)}><Pencil size={15} /> Update today’s data</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {snap.curves.map((c) => (
          <CurveBlock key={c.commodity} curve={c} live={pickLive(live, c.commodity)} trend={trends[c.commodity]} />
        ))}
      </div>

      <p className="text-[11px] text-brand-muted italic">
        Forward prices are indicative market levels from the cited report, for information only — not a price quotation or an offer to trade. General market commentary, not financial advice.
      </p>
    </section>
  );
}
