// Dependency-free SVG line-chart renderer (browser). Produces a branded chart
// SVG string from a {t,v}[] series; we rasterise it to PNG for embedding in the
// client-generated PDF and Word exports.

export interface ChartOptions {
  points: { t: string; v: number }[];
  title?: string;
  unit?: string;
  source?: string;
  width?: number;
  height?: number;
  color?: string;
}

const GREEN = '#40A800';
const INK = '#2B2A2E';
const MUTED = '#6B6A70';
const LINE = '#E7E8E6';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fmtDate(t: string): string {
  const [y, m] = t.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(Number(m) || 1) - 1] ?? ''} '${(y || '').slice(2)}`;
}
function niceNum(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function renderLineChartSVG(opts: ChartOptions): string {
  const W = opts.width ?? 760;
  const H = opts.height ?? 300;
  const color = opts.color ?? GREEN;
  const pts = opts.points.filter((p) => Number.isFinite(p.v));
  const titleLine = `${esc(opts.title ?? 'Price')}${opts.unit ? ` <tspan fill="${MUTED}">(${esc(opts.unit)})</tspan>` : ''}`;

  if (pts.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/><text x="16" y="26" font-size="15" font-weight="600" fill="${INK}">${titleLine}</text><text x="${W / 2}" y="${H / 2}" font-size="13" fill="${MUTED}" text-anchor="middle">Not enough data to chart.</text></svg>`;
  }

  const L = 52, R = 18, T = 40, B = 34;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const vals = pts.map((p) => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;

  const x = (i: number) => L + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => T + plotH - ((v - min) / (max - min)) * plotH;

  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const yy = y(v);
    grid += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${L + plotW}" y2="${yy.toFixed(1)}" stroke="${LINE}" stroke-width="1"/>`;
    grid += `<text x="${L - 8}" y="${(yy + 3.5).toFixed(1)}" font-size="10" fill="${MUTED}" text-anchor="end">${niceNum(v)}</text>`;
  }

  const xIdx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  const xLabels = xIdx
    .map((i, k) => {
      const anchor = k === 0 ? 'start' : k === xIdx.length - 1 ? 'end' : 'middle';
      return `<text x="${x(i).toFixed(1)}" y="${H - 12}" font-size="10" fill="${MUTED}" text-anchor="${anchor}">${fmtDate(pts[i].t)}</text>`;
    })
    .join('');

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(pts.length - 1).toFixed(1)},${(T + plotH).toFixed(1)} L${x(0).toFixed(1)},${(T + plotH).toFixed(1)} Z`;
  const last = pts[pts.length - 1];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text x="${L - 44}" y="24" font-size="15" font-weight="600" fill="${INK}">${titleLine}</text>
  ${grid}
  <path d="${areaPath}" fill="${color}" fill-opacity="0.10"/>
  <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.5" fill="${color}"/>
  ${xLabels}
  ${opts.source ? `<text x="${W - R}" y="24" font-size="9.5" fill="${MUTED}" text-anchor="end">Source: ${esc(opts.source)}</text>` : ''}
</svg>`;
}
