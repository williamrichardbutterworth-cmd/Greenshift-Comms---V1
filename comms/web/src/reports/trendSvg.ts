// Build the procure-ahead FORWARD-CURVE chart as an SVG string, using the template's own
// CSS classes (.series/.area/.dot/.gridline/.axislab/.monthlab/.nowlab) so it matches the
// report's design.

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

const escSvg = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Build the FORWARD-CURVE chart (the same curve shown on the dashboard): each forward
// delivery period (x) against its price (y), using the template's CSS classes. The
// client's renewal period — mapped from their contract end — is marked so the report
// reads against where THEY would be buying.
export function buildForwardCurveSvg(
  legs: { label: string; value: number }[],
  opts: { unit?: string; highlightIdx?: number; highlightLabel?: string } = {},
): string {
  const pts = legs.filter((l) => Number.isFinite(l.value));
  if (pts.length < 2) {
    return `<svg class="trend" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg"><text x="${VB_W / 2}" y="${VB_H / 2}" text-anchor="middle" class="axislab">Capture a forward curve in the dashboard to chart it here.</text></svg>`;
  }
  const vals = pts.map((p) => p.value);
  const { lo, hi } = niceBounds(Math.min(...vals), Math.max(...vals));
  const sym = (opts.unit ?? '£/MWh').trim().startsWith('£') || (opts.unit ?? '').includes('MWh') ? '£' : '';
  const fmt = (n: number) => `${sym}${Math.round(n)}`;
  const x = (i: number) => X0 + (i / (pts.length - 1)) * (X1 - X0);
  const y = (v: number) => Y_BOT - ((v - lo) / (hi - lo || 1)) * (Y_BOT - Y_TOP);

  const linePts = pts.map((p, i) => `${round1(x(i))},${round1(y(p.value))}`).join(' ');
  const areaPath = `M${round1(x(0))},${round1(y(pts[0].value))} ` +
    pts.slice(1).map((p, i) => `L${round1(x(i + 1))},${round1(y(p.value))}`).join(' ') +
    ` L${round1(x(pts.length - 1))},${BASE_Y} L${round1(x(0))},${BASE_Y} Z`;

  const ticks: string[] = [];
  const step = (hi - lo) / 4;
  for (let k = 0; k <= 4; k++) {
    const vv = lo + step * k; const yy = round1(y(vv));
    ticks.push(`<line class="gridline" x1="${X0}" y1="${yy}" x2="${X1}" y2="${yy}"/>`);
    ticks.push(`<text class="axislab" x="${X1 + 6}" y="${yy + 3}">${fmt(vv)}</text>`);
  }

  const hIdx = opts.highlightIdx != null && opts.highlightIdx >= 0 && opts.highlightIdx < pts.length ? opts.highlightIdx : -1;
  // x-axis = the delivery-period labels (thin out when crowded; always show first/last/renewal)
  const thin = pts.length > 8 ? 2 : 1;
  const labs = pts.map((p, i) => {
    const show = i === 0 || i === pts.length - 1 || i === hIdx || i % thin === 0;
    return show ? `<text class="monthlab" x="${round1(x(i))}" y="206">${escSvg(p.label)}</text>` : '';
  }).join('');

  const marks: string[] = [`<circle class="dot" cx="${round1(x(0))}" cy="${round1(y(pts[0].value))}" r="3.4"/>`];
  if (hIdx >= 0) {
    const hx = round1(x(hIdx)), hy = round1(y(pts[hIdx].value));
    const labY = Math.max(14, hy - 9);
    marks.push(`<line x1="${hx}" y1="${hy}" x2="${hx}" y2="${BASE_Y}" stroke="#318300" stroke-width="1" stroke-dasharray="3 3" opacity=".45"/>`);
    marks.push(`<circle cx="${hx}" cy="${hy}" r="5" fill="#318300" stroke="#fff" stroke-width="2"/>`);
    marks.push(`<text class="nowlab" x="${hx}" y="${labY}" text-anchor="middle">${fmt(pts[hIdx].value)}</text>`);
    marks.push(`<text x="${hx}" y="${Math.max(6, labY - 11)}" text-anchor="middle" style="font-family:'IBM Plex Mono',monospace;font-size:8px;fill:#318300;font-weight:600">${escSvg(opts.highlightLabel || 'your renewal')}</text>`);
  } else {
    const li = pts.length - 1, lx = round1(x(li)), ly = round1(y(pts[li].value));
    marks.push(`<circle class="dot" cx="${lx}" cy="${ly}" r="3.4"/>`);
    marks.push(`<text class="nowlab" x="${lx - 8}" y="${ly - 9}" text-anchor="end">${fmt(pts[li].value)}</text>`);
  }

  return `<svg class="trend" viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="UK power baseload forward curve by delivery period.">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#40A800" stop-opacity=".16"/><stop offset="1" stop-color="#40A800" stop-opacity="0"/></linearGradient></defs>
  ${ticks.join('')}
  <path class="area" d="${areaPath}"/>
  <polyline class="series" points="${linePts}"/>
  ${marks.join('')}
  ${labs}
</svg>`;
}
