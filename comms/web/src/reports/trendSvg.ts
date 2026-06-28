// Build the procure-ahead trend chart as an SVG string, using the template's own CSS
// classes (.series/.area/.dot/.gridline/.axislab/.monthlab/.nowlab). Generated from
// the real power series so the line, axis and "Now" point reflect live data.

interface Point { t: string; v: number }

const VB_W = 760, VB_H = 230;
const X0 = 10, X1 = 710;       // plot x-range (axis labels sit beyond X1)
const Y_TOP = 40, Y_BOT = 185; // plot y-range
const BASE_Y = 188;            // area baseline

function niceBounds(min: number, max: number): { lo: number; hi: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const c = Number.isFinite(min) ? min : 0;
    return { lo: c - 5, hi: c + 5 };
  }
  const pad = (max - min) * 0.18 || 1;
  const step = niceStep((max - min + 2 * pad) / 4);
  const lo = Math.floor((min - pad) / step) * step;
  const hi = Math.ceil((max + pad) / step) * step;
  return { lo, hi };
}
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildTrendSvg(points: Point[], opts: { unit?: string; valueFmt?: (n: number) => string } = {}): string {
  const pts = points.filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) {
    return `<svg class="trend" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg"><text x="${VB_W / 2}" y="${VB_H / 2}" text-anchor="middle" class="axislab">Capture more market data to chart the trend.</text></svg>`;
  }
  const vals = pts.map((p) => p.v);
  const { lo, hi } = niceBounds(Math.min(...vals), Math.max(...vals));
  const sym = (opts.unit ?? '£/MWh').trim().startsWith('£') || (opts.unit ?? '').includes('MWh') ? '£' : '';
  const fmt = opts.valueFmt ?? ((n: number) => `${sym}${Math.round(n)}`);

  const x = (i: number) => X0 + (i / (pts.length - 1)) * (X1 - X0);
  const y = (v: number) => Y_BOT - ((v - lo) / (hi - lo || 1)) * (Y_BOT - Y_TOP);

  const linePts = pts.map((p, i) => `${round1(x(i))},${round1(y(p.v))}`).join(' ');
  const areaPath = `M${round1(x(0))},${round1(y(pts[0].v))} ` +
    pts.slice(1).map((p, i) => `L${round1(x(i + 1))},${round1(y(p.v))}`).join(' ') +
    ` L${round1(x(pts.length - 1))},${BASE_Y} L${round1(x(0))},${BASE_Y} Z`;

  // y gridlines + labels (4 ticks)
  const ticks: string[] = [];
  const step = (hi - lo) / 4;
  for (let k = 0; k <= 4; k++) {
    const v = lo + step * k;
    const yy = round1(y(v));
    ticks.push(`<line class="gridline" x1="${X0}" y1="${yy}" x2="${X1}" y2="${yy}"/>`);
    ticks.push(`<text class="axislab" x="${X1 + 6}" y="${yy + 3}">${fmt(v)}</text>`);
  }

  // month labels — up to ~7 evenly spaced; last is "Now"
  const labelCount = Math.min(7, pts.length);
  const monthLabs: string[] = [];
  for (let k = 0; k < labelCount; k++) {
    const i = Math.round((k / (labelCount - 1)) * (pts.length - 1));
    const last = k === labelCount - 1;
    const text = last ? 'Now' : monthAbbr(pts[i].t);
    monthLabs.push(`<text class="monthlab" x="${round1(x(i))}" y="206">${text}</text>`);
  }

  const lastV = pts[pts.length - 1].v;
  const lastX = round1(x(pts.length - 1));
  const lastY = round1(y(lastV));

  return `<svg class="trend" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Twelve month wholesale power price trend.">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#40A800" stop-opacity=".16"/><stop offset="1" stop-color="#40A800" stop-opacity="0"/></linearGradient></defs>
  ${ticks.join('')}
  <path class="area" d="${areaPath}"/>
  <polyline class="series" points="${linePts}"/>
  <circle class="dot" cx="${lastX}" cy="${lastY}" r="4.2"/>
  <text class="nowlab" x="${lastX - 10}" y="${lastY - 10}" text-anchor="end">${fmt(lastV)}</text>
  ${monthLabs.join('')}
</svg>`;
}

function monthAbbr(t: string): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { month: 'short' });
}
