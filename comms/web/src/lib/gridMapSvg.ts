// Dependency-free SVG renderer for a stylised UK generation map. Like chartSvg.ts,
// it returns an SVG string so the same picture renders on the dashboard AND can be
// rasterised to PNG for the branded PDF/Word report export.
//
// It is a SCHEMATIC tile-grid (not precise geography): the 14 GB DNO licence areas
// laid out in their rough compass positions, shaded by NESO carbon-intensity index
// (or by dominant fuel). Regional figures are NESO model estimates, not metered.

export interface GridMapRegion {
  id: number;
  name: string;
  intensity: number | null;
  index: 'very low' | 'low' | 'moderate' | 'high' | 'very high' | null;
  mix: { fuel: string; pct: number }[];
}

export interface GridMapOptions {
  regions: GridMapRegion[];
  mode?: 'intensity' | 'fuel';
  width?: number;
  title?: string;
}

const INK = '#2B2A2E';
const MUTED = '#6B6A70';
const LINE = '#E7E8E6';

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Carbon-intensity index → colour (green = clean → red = dirty).
const INDEX_COLOR: Record<string, string> = {
  'very low': '#2E7D32',
  low: '#66BB6A',
  moderate: '#F4B400',
  high: '#EF6C00',
  'very high': '#C62828',
};
const INDEX_ORDER = ['very low', 'low', 'moderate', 'high', 'very high'];

// Fuel → colour (matches the dashboard generation-mix palette family).
const FUEL_COLOR: Record<string, string> = {
  Wind: '#40A800', Gas: '#6B6A70', Nuclear: '#318300', Solar: '#F4B400',
  Imports: '#73C13B', Biomass: '#9BD46A', Hydro: '#2E7D32', Coal: '#2B2A2E',
  Oil: '#8D6E63', 'Pumped storage': '#A7A6AB', Other: '#C9C8CC',
};

// Compact tile labels keyed by DNO regionid (the API short names are long).
const SHORT: Record<number, string> = {
  1: 'N Scotland', 2: 'S Scotland', 3: 'NW England', 4: 'NE England',
  5: 'Yorkshire', 6: 'N Wales & Mersey', 7: 'S Wales', 8: 'W Midlands',
  9: 'E Midlands', 10: 'E England', 11: 'SW England', 12: 'S England',
  13: 'London', 14: 'SE England',
};

// The largest row index in POS below (region 11) — drives the canvas height.
const MAX_ROW = 5.4;

// Rough geographic grid position (col, row) per regionid — north at top, west at left.
const POS: Record<number, { c: number; r: number }> = {
  1: { c: 1.5, r: 0 },
  2: { c: 1.5, r: 1 },
  3: { c: 0.7, r: 2.1 },
  4: { c: 1.85, r: 2.1 },
  5: { c: 1.95, r: 3.0 },
  6: { c: 0.45, r: 3.3 },
  8: { c: 1.35, r: 3.65 },
  9: { c: 2.2, r: 3.75 },
  10: { c: 3.0, r: 4.0 },
  7: { c: 0.5, r: 4.4 },
  12: { c: 1.7, r: 4.7 },
  13: { c: 2.45, r: 4.6 },
  14: { c: 2.95, r: 5.0 },
  11: { c: 0.7, r: 5.4 },
};

// Pick readable text colour for a given fill (relative luminance).
function textOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? INK : '#ffffff';
}

const dominantFuel = (mix: { fuel: string; pct: number }[]) =>
  mix && mix.length ? [...mix].sort((a, b) => b.pct - a.pct)[0] : null;

function regionFill(r: GridMapRegion, mode: 'intensity' | 'fuel'): { fill: string; sub: string } {
  if (mode === 'fuel') {
    const d = dominantFuel(r.mix);
    return d ? { fill: FUEL_COLOR[d.fuel] ?? '#C9C8CC', sub: `${d.fuel} ${Math.round(d.pct)}%` } : { fill: '#E7E8E6', sub: '—' };
  }
  return {
    fill: (r.index && INDEX_COLOR[r.index]) || '#E7E8E6',
    sub: r.intensity != null ? `${r.intensity} g` : '—',
  };
}

// Deterministic canvas height for a given width — so the PDF/Word exporter can
// rasterise the map without re-deriving the layout.
export function gridMapHeight(width = 460): number {
  const cellW = (width - 40) / 3.9;
  const cellH = cellW * 0.82;
  const tileH = cellH - 8;
  const legendY = 44 + MAX_ROW * cellH + tileH + 16;
  return Math.round(legendY + 46);
}

export function renderGridMapSVG(opts: GridMapOptions): string {
  const mode = opts.mode ?? 'intensity';
  const byId = new Map(opts.regions.map((r) => [r.id, r]));

  const W = opts.width ?? 460;
  const ORIGIN_X = 20, ORIGIN_Y = 44;
  const CELL_W = (W - ORIGIN_X * 2) / 3.9; // 3.9 columns of headroom
  const CELL_H = CELL_W * 0.82;
  const TILE_W = CELL_W - 8, TILE_H = CELL_H - 8;

  const legendY = ORIGIN_Y + MAX_ROW * CELL_H + TILE_H + 16;
  const H = gridMapHeight(W);

  // Tiles
  let tiles = '';
  for (let id = 1; id <= 14; id++) {
    const pos = POS[id];
    if (!pos) continue;
    const r = byId.get(id);
    const x = ORIGIN_X + pos.c * CELL_W;
    const y = ORIGIN_Y + pos.r * CELL_H;
    const { fill, sub } = r ? regionFill(r, mode) : { fill: '#F2F3F2', sub: '—' };
    const tx = textOn(fill);
    const label = SHORT[id] ?? r?.name ?? `#${id}`;
    const title = r
      ? `${r.name} — ${r.intensity != null ? r.intensity + ' gCO₂/kWh' : 'n/a'}${r.index ? ` (${r.index})` : ''}` +
        (r.mix?.length ? `\n${[...r.mix].slice(0, 3).map((m) => `${m.fuel} ${Math.round(m.pct)}%`).join(', ')}` : '')
      : label;
    tiles +=
      `<g><title>${esc(title)}</title>` +
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${TILE_W.toFixed(1)}" height="${TILE_H.toFixed(1)}" rx="7" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>` +
      `<text x="${(x + TILE_W / 2).toFixed(1)}" y="${(y + TILE_H / 2 - 6).toFixed(1)}" font-size="9" fill="${tx}" text-anchor="middle" opacity="0.92">${esc(label)}</text>` +
      `<text x="${(x + TILE_W / 2).toFixed(1)}" y="${(y + TILE_H / 2 + 12).toFixed(1)}" font-size="15" font-weight="700" fill="${tx}" text-anchor="middle">${esc(sub)}</text>` +
      `</g>`;
  }

  // Legend
  let legend = '';
  if (mode === 'intensity') {
    const sw = (W - 40) / INDEX_ORDER.length;
    legend = INDEX_ORDER.map((idx, i) => {
      const lx = 20 + i * sw;
      return (
        `<rect x="${lx.toFixed(1)}" y="${legendY}" width="${(sw - 6).toFixed(1)}" height="10" rx="2" fill="${INDEX_COLOR[idx]}"/>` +
        `<text x="${lx.toFixed(1)}" y="${legendY + 26}" font-size="9" fill="${MUTED}">${esc(idx)}</text>`
      );
    }).join('');
  } else {
    const fuels = [...new Set(opts.regions.flatMap((r) => (r.mix ?? []).map((m) => m.fuel)))]
      .filter((f) => FUEL_COLOR[f]).slice(0, 7);
    const sw = (W - 40) / Math.max(1, fuels.length);
    legend = fuels.map((f, i) => {
      const lx = 20 + i * sw;
      return (
        `<rect x="${lx.toFixed(1)}" y="${legendY}" width="10" height="10" rx="2" fill="${FUEL_COLOR[f]}"/>` +
        `<text x="${(lx + 14).toFixed(1)}" y="${legendY + 9}" font-size="9" fill="${MUTED}">${esc(f)}</text>`
      );
    }).join('');
  }

  const subtitle = mode === 'intensity' ? 'Estimated regional carbon intensity (gCO₂/kWh)' : 'Estimated dominant generation fuel by region';
  const ariaLabel = `${opts.title ?? 'GB regional grid'} — ${subtitle}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}" font-family="Arial, sans-serif" role="img" aria-label="${esc(ariaLabel)}">
  <title>${esc(ariaLabel)}</title>
  <rect width="${W}" height="${H.toFixed(0)}" fill="#ffffff"/>
  <text x="20" y="22" font-size="13" font-weight="600" fill="${INK}">${esc(opts.title ?? 'GB regional grid')}</text>
  <text x="20" y="37" font-size="9.5" fill="${MUTED}">${esc(subtitle)}</text>
  ${tiles}
  ${legend}
</svg>`;
}
