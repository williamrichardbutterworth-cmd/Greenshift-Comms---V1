import { useEffect, useState } from 'react';
import { Map as MapIcon, ArrowRight, ArrowLeft, Minus, Loader2, RefreshCw } from 'lucide-react';
import { api, type GridSnapshot } from '../lib/api';
import { renderGridMapSVG } from '../lib/gridMapSvg';

const INDEX_TEXT: Record<string, string> = {
  'very low': 'text-down', low: 'text-down', moderate: 'text-brand-ink', high: 'text-up', 'very high': 'text-up',
};

function NationalBadge({ intensity, index }: { intensity: number | null; index: string | null }) {
  if (intensity == null) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-2xl font-semibold leading-none">{intensity}</span>
      <span className="text-sm text-brand-muted">gCO₂/kWh</span>
      {index && <span className={'text-xs font-medium capitalize ' + (INDEX_TEXT[index] ?? 'text-brand-muted')}>· {index}</span>}
    </div>
  );
}

// The UK generation map: a schematic tile-grid of the 14 GB DNO regions shaded by
// estimated carbon intensity (or dominant fuel), plus live interconnector flows.
export function GenerationMap() {
  const [grid, setGrid] = useState<GridSnapshot | null>(null);
  const [mode, setMode] = useState<'intensity' | 'fuel'>('intensity');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.grid()
      .then((g) => { setGrid(g); setErr(null); })
      .catch((e) => setErr(String((e as Error).message)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (err && !grid) return null; // degrade silently — the rest of the dashboard still works
  if (!grid) return <section className="card p-5"><div className="h-64 grid place-items-center text-sm text-brand-muted"><Loader2 size={18} className="animate-spin" /></div></section>;

  const netImport = grid.interconnectors.reduce((a, i) => a + i.mw, 0);
  const svg = renderGridMapSVG({ regions: grid.regions, mode, title: 'GB regional grid' });

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-green/10 text-brand-greenDark">
          <MapIcon size={16} />
        </span>
        <div className="min-w-0 mr-2">
          <h3 className="text-sm font-semibold leading-tight">Generation map</h3>
          <p className="text-[11px] text-brand-muted">Live grid intensity & interconnector flows</p>
        </div>
        <NationalBadge intensity={grid.national.intensity} index={grid.national.index} />
        <div className="flex-1" />
        <div className="inline-flex rounded-lg border border-brand-line overflow-hidden text-xs">
          {(['intensity', 'fuel'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={'px-2.5 py-1.5 capitalize transition ' + (mode === m ? 'bg-brand-green text-white' : 'bg-white text-brand-muted hover:bg-brand-tint')}
            >
              {m === 'intensity' ? 'Carbon' : 'Fuel'}
            </button>
          ))}
        </div>
        <button className="btn-ghost !px-2 !py-1.5" onClick={load} disabled={loading} title="Refresh grid data">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
        {/* The map */}
        <div className="rounded-lg overflow-hidden" dangerouslySetInnerHTML={{ __html: svg }} />

        {/* Interconnectors + national mix */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="label">Interconnectors</div>
              <div className="text-[11px] text-brand-muted">
                Net {netImport >= 0 ? 'import' : 'export'} <span className="font-mono font-semibold text-brand-ink">{Math.abs(netImport).toLocaleString('en-GB')} MW</span>
              </div>
            </div>
            <div className="space-y-1">
              {grid.interconnectors.map((ic) => {
                const Icon = ic.dir === 'import' ? ArrowRight : ic.dir === 'export' ? ArrowLeft : Minus;
                // Neutral tones — direction is shown by the arrow, not a good/bad colour.
                const tone = ic.dir === 'import' ? 'text-brand-greenDark' : 'text-brand-muted';
                return (
                  <div key={ic.code} className="flex items-center gap-2 text-xs">
                    <Icon size={13} className={tone + ' shrink-0'} />
                    <span className="flex-1 truncate text-brand-ink" title={ic.name}>{ic.name}</span>
                    <span className="font-mono text-brand-muted">{Math.abs(ic.mw).toLocaleString('en-GB')} MW</span>
                  </div>
                );
              })}
              {!grid.interconnectors.length && <p className="text-xs text-brand-muted">Interconnector flows unavailable.</p>}
            </div>
          </div>

          {grid.national.mix.length > 0 && (
            <div>
              <div className="label mb-1.5">National mix — NESO estimate (incl. solar)</div>
              <div className="space-y-1">
                {grid.national.mix.slice(0, 6).map((f) => (
                  <div key={f.fuel} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-brand-ink truncate shrink-0">{f.fuel}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-brand-line/60 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-green" style={{ width: `${f.pct}%` }} />
                    </div>
                    <span className="font-mono text-brand-muted w-9 text-right shrink-0">{f.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-brand-muted mt-3">
        Regional figures are NESO model estimates (indicative), not metered. As of {new Date(grid.asOf).toLocaleString('en-GB')}.{' '}
        {grid.sources.map((s) => s.attribution).filter(Boolean).join(' ')}
      </p>
    </section>
  );
}
