import type { CommodityCurve, CurveLeg, Commodity } from './api';
import { renderLineChartSVG, type ChartOptions } from './chartSvg';

// Shared forward-curve analytics — season ordering, backwardation detection and
// the "procure now" saving figures. Used by both the dashboard hero and the
// client-report node so they always tell the same story.

export const commodityLabel = (c: Commodity): string => (c === 'power' ? 'Power baseload' : 'Gas (NBP)');

// The tradeable value for a leg: prefer the live offer, then the latest settle.
export const legValue = (l: CurveLeg): number | null => l.current ?? l.latest ?? l.prev;

const SEASON_NUM: Record<string, number> = { sum: 0, summer: 0, win: 1, winter: 1 };

// Chronological sort key for a season label (e.g. "Win 26", "Sum 27"). Summer
// (Apr–Sep) precedes Winter (Oct–Mar) within the same delivery year. Returns
// null for non-season labels (DA, months, quarters).
export function seasonSortKey(label: string): number | null {
  const m = label.trim().match(/^(sum|summer|win|winter)\s*'?\s*(\d{2,4})$/i);
  if (!m) return null;
  let yr = parseInt(m[2], 10);
  if (yr < 100) yr += 2000;
  return yr * 2 + SEASON_NUM[m[1].toLowerCase()];
}
export const isSeasonLabel = (label: string): boolean => seasonSortKey(label) !== null;

// The "term" legs to plot as the forward curve: the seasonal strip if we have
// two or more seasons (the clean backwardation story), otherwise every non-DA
// leg in the order given (a sensible fallback for sparse reports).
export function termLegs(curve: CommodityCurve): CurveLeg[] {
  const seasons = curve.legs.filter((l) => isSeasonLabel(l.label) && legValue(l) != null);
  if (seasons.length >= 2) {
    return seasons.slice().sort((a, b) => (seasonSortKey(a.label)! - seasonSortKey(b.label)!));
  }
  return curve.legs.filter((l) => !/^da$/i.test(l.label) && legValue(l) != null);
}

export interface CurveAnalysis {
  terms: CurveLeg[];
  front: CurveLeg;
  cheapest: CurveLeg;
  furthest: CurveLeg;
  frontValue: number;
  cheapestValue: number;
  furthestValue: number;
  /** % the cheapest forward term sits below the front term (0 if none cheaper). */
  savingPct: number;
  /** Furthest delivery is cheaper than the front — a genuinely downward (backwardated) curve. */
  isBackwardation: boolean;
  /** Some forward term is cheaper than the front (even if only mid-curve). */
  hasForwardValue: boolean;
}

// The honest read of the curve. "backwardation" = the whole forward slopes down
// (the strong buy-ahead case); "value" = the curve is flat/rising overall but a
// specific forward window is cheaper than the front; "contango" = nothing
// forward is cheaper, so buying long is not the better move.
export type CurveSignal = 'backwardation' | 'value' | 'contango';
export function curveSignal(a: CurveAnalysis): CurveSignal {
  if (a.isBackwardation && a.savingPct > 0) return 'backwardation';
  if (a.hasForwardValue && a.savingPct > 0) return 'value';
  return 'contango';
}

export function analyzeCurve(curve: CommodityCurve): CurveAnalysis | null {
  const terms = termLegs(curve);
  if (terms.length < 2) return null;
  const front = terms[0];
  const furthest = terms[terms.length - 1];
  const frontValue = legValue(front)!;
  const furthestValue = legValue(furthest)!;
  let cheapest = front;
  let cheapestValue = frontValue;
  for (const l of terms) {
    const v = legValue(l)!;
    if (v < cheapestValue) { cheapest = l; cheapestValue = v; }
  }
  return {
    terms, front, cheapest, furthest, frontValue, cheapestValue, furthestValue,
    savingPct: frontValue > 0 ? Math.round(((frontValue - cheapestValue) / frontValue) * 100) : 0,
    // Backwardation is a property of the curve SLOPE (furthest < front), NOT of a
    // single cheap interior season — otherwise we'd wrongly tell a client a
    // contango curve favours buying long. The cheaper-interior case is "value".
    isBackwardation: furthestValue < frontValue,
    hasForwardValue: cheapestValue < frontValue,
  };
}

export const fmtPrice = (v: number | null, unit?: string): string =>
  v == null ? '—' : `${v.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`;

// One-line headline for the dashboard callout — matched to the true signal.
export function backwardationHeadline(curve: CommodityCurve, a: CurveAnalysis): string {
  const noun = curve.commodity === 'power' ? 'power' : 'gas';
  switch (curveSignal(a)) {
    case 'backwardation':
      return `${a.cheapest.label} is ${a.savingPct}% below ${a.front.label} — the curve is in backwardation, so securing ahead locks in cheaper ${noun}.`;
    case 'value':
      return `${a.cheapest.label} is trading ${a.savingPct}% below the front (${a.front.label}) — there’s value securing that window ahead, though the curve overall isn’t backwardated.`;
    default:
      return `The forward ${noun} curve is in contango (later delivery costs more than the front) — near-term cover looks better value than buying long.`;
  }
}

// Fuller narrative for a client report — accurate to whichever shape the curve is.
export function procurementNarrative(curve: CommodityCurve, a: CurveAnalysis): string {
  const noun = curve.commodity === 'power' ? 'electricity' : 'gas';
  const u = curve.unit;
  switch (curveSignal(a)) {
    case 'backwardation':
      return `The UK ${noun} forward curve is in backwardation: the front season (${a.front.label}) is trading at ${fmtPrice(a.frontValue, u)}, while later delivery is cheaper — ${a.cheapest.label} is ${fmtPrice(a.cheapestValue, u)}, around ${a.savingPct}% lower, and even the furthest season shown (${a.furthest.label}) at ${fmtPrice(a.furthestValue, u)} sits below the front. Because energy for delivery further out is currently cheaper than the nearest season, fixing forward now secures lower prices than waiting and rolling onto near-term cover, and removes the risk of an upward move before your renewal.`;
    case 'value':
      return `The UK ${noun} forward curve is broadly flat-to-rising overall — the furthest season shown (${a.furthest.label}) is ${fmtPrice(a.furthestValue, u)} against ${fmtPrice(a.frontValue, u)} at the front (${a.front.label}) — but there is a pocket of value mid-curve: ${a.cheapest.label} is trading at ${fmtPrice(a.cheapestValue, u)}, about ${a.savingPct}% below the front. Securing that specific period ahead could lock in a saving, so we’d target that window rather than fixing the whole term long, and keep watching for the curve to turn.`;
    default:
      return `The UK ${noun} forward curve is in contango: the front season (${a.front.label}) is ${fmtPrice(a.frontValue, u)} and later delivery is priced at or above it, out to ${a.furthest.label} at ${fmtPrice(a.furthestValue, u)}. With nothing cheaper further out, a shorter or staged purchase looks better value than fixing long today. We monitor this daily and will flag the moment the curve favours buying ahead.`;
  }
}

// Chart options for the forward curve (season strip). Shared by the dashboard
// and the report export so both show an identical chart.
export function forwardCurveChartOptions(
  curve: CommodityCurve,
  opts: { width?: number; height?: number; field?: 'value' | 'latest' } = {},
): ChartOptions {
  const terms = termLegs(curve);
  const points = terms.map((l) => ({ t: l.label, v: (opts.field === 'latest' ? l.latest : legValue(l)) ?? NaN }));
  return {
    points,
    title: `${commodityLabel(curve.commodity)} — forward curve`,
    unit: curve.unit,
    categoryAxis: true,
    width: opts.width,
    height: opts.height,
  };
}
export const forwardCurveChartSVG = (curve: CommodityCurve, opts: { width?: number; height?: number; field?: 'value' | 'latest' } = {}): string =>
  renderLineChartSVG(forwardCurveChartOptions(curve, opts));
