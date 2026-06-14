import { config } from '../config';
import { fetchJson } from '../lib/http';
import { cache } from '../lib/cache';
import { CARBON_SOURCE } from '../providers/marketData/carbonIntensity';
import type { SourceRef, FuelShare } from '../providers/marketData/types';

// Data backbone for the UK generation map (GET /api/grid). Keyless:
//   - National + regional carbon intensity & fuel mix : NESO Carbon Intensity API
//   - Per-interconnector import/export flows           : Elexon FUELINST (BMRS)
// Regional figures are NESO MODEL ESTIMATES (not metered) — the UI labels them so.

const CI_BASE = 'https://api.carbonintensity.org.uk';
const ELEXON_ATTRIBUTION =
  'Contains data from Elexon Insights (BMRS), used under the BMRS Data Licence Terms.';
const ELEXON_SOURCE: SourceRef = {
  name: 'Elexon (BMRS)',
  url: 'https://bmrs.elexon.co.uk',
  attribution: ELEXON_ATTRIBUTION,
};

export type GridIndex = 'very low' | 'low' | 'moderate' | 'high' | 'very high' | null;

export interface GridRegion {
  id: number;
  name: string; // short name, e.g. "London"
  dno: string; // full DNO licence-area name
  intensity: number | null; // gCO₂/kWh (forecast/estimated)
  index: GridIndex;
  mix: FuelShare[]; // estimated regional generation mix
}

export interface Interconnector {
  code: string; // FUELINST code, e.g. INTFR
  name: string; // friendly link name, e.g. "IFA (France)"
  country: string;
  mw: number; // signed: positive = importing to GB, negative = exporting
  dir: 'import' | 'export' | 'idle';
}

export interface GridSnapshot {
  asOf: string;
  national: { intensity: number | null; index: GridIndex; mix: FuelShare[] };
  regions: GridRegion[];
  interconnectors: Interconnector[];
  sources: SourceRef[];
}

// FUELINST INT* code → friendly name + counterparty country.
const INTERCONNECTORS: Record<string, { name: string; country: string }> = {
  INTFR: { name: 'IFA', country: 'France' },
  INTIFA2: { name: 'IFA2', country: 'France' },
  INTELEC: { name: 'ElecLink', country: 'France' },
  INTNED: { name: 'BritNed', country: 'Netherlands' },
  INTNEM: { name: 'Nemo', country: 'Belgium' },
  INTNSL: { name: 'North Sea Link', country: 'Norway' },
  INTVKL: { name: 'Viking', country: 'Denmark' },
  INTIRL: { name: 'Moyle', country: 'Ireland' },
  INTEW: { name: 'East-West', country: 'Ireland' },
  INTGRNL: { name: 'Greenlink', country: 'Ireland' },
};

// Normalise the Carbon Intensity fuel names to our title-case palette labels.
const FUEL_LABEL: Record<string, string> = {
  gas: 'Gas', coal: 'Coal', nuclear: 'Nuclear', wind: 'Wind', solar: 'Solar',
  hydro: 'Hydro', biomass: 'Biomass', imports: 'Imports', other: 'Other',
};
const mapMix = (gm: { fuel: string; perc: number }[]): FuelShare[] =>
  (gm ?? [])
    .map((g) => ({ fuel: FUEL_LABEL[g.fuel] ?? g.fuel, pct: Math.round(g.perc * 10) / 10 }))
    .filter((f) => f.pct > 0)
    .sort((a, b) => b.pct - a.pct);

const isoHoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const nowIso = () => new Date().toISOString();

async function nationalIntensity(): Promise<{ intensity: number | null; index: GridIndex }> {
  try {
    const raw = await fetchJson<{ data: { intensity: { forecast: number | null; actual: number | null; index: string | null } }[] }>(
      `${CI_BASE}/intensity`,
    );
    const i = raw?.data?.[0]?.intensity;
    const v = i ? (i.actual ?? i.forecast) : null;
    // Guard on null, not truthiness — a genuine 0 gCO₂/kWh (fully renewable) is valid.
    return { intensity: v == null ? null : Math.round(v), index: (i?.index as GridIndex) ?? null };
  } catch (err) {
    console.warn('[grid] national intensity unavailable:', (err as Error).message);
    return { intensity: null, index: null };
  }
}

async function nationalMix(): Promise<FuelShare[]> {
  try {
    const raw = await fetchJson<{ data: { generationmix: { fuel: string; perc: number }[] } }>(`${CI_BASE}/generation`);
    return mapMix(raw?.data?.generationmix ?? []);
  } catch (err) {
    console.warn('[grid] national mix unavailable:', (err as Error).message);
    return [];
  }
}

async function regions(): Promise<GridRegion[]> {
  try {
    const raw = await fetchJson<{
      data: { regions: { regionid: number; dnoregion: string; shortname: string; intensity: { forecast: number | null; index: string | null }; generationmix: { fuel: string; perc: number }[] }[] }[];
    }>(`${CI_BASE}/regional`);
    const list = raw?.data?.[0]?.regions ?? [];
    // regionid 1–14 are the GB DNO licence areas; 15–18 are England/Scotland/Wales/GB aggregates — skip.
    return list
      .filter((r) => r.regionid >= 1 && r.regionid <= 14)
      .map((r) => ({
        id: r.regionid,
        name: r.shortname,
        dno: r.dnoregion,
        intensity: r.intensity?.forecast ?? null,
        index: (r.intensity?.index as GridIndex) ?? null,
        mix: mapMix(r.generationmix ?? []),
      }));
  } catch (err) {
    console.warn('[grid] regional data unavailable:', (err as Error).message);
    return [];
  }
}

async function interconnectors(): Promise<Interconnector[]> {
  try {
    const base = config.elexonBaseUrl;
    const raw = await fetchJson<any>(
      `${base}/datasets/FUELINST?publishDateTimeFrom=${encodeURIComponent(isoHoursAgo(3))}` +
        `&publishDateTimeTo=${encodeURIComponent(nowIso())}&format=json`,
    );
    const rows: any[] = Array.isArray(raw) ? raw : raw?.data ?? [];
    if (!rows.length) return [];
    const latestTime = rows.reduce((m, r) => (r.startTime > m ? r.startTime : m), rows[0].startTime);
    const latest = rows.filter((r) => r.startTime === latestTime && String(r.fuelType ?? '').startsWith('INT'));
    return latest
      .map((r) => {
        const meta = INTERCONNECTORS[r.fuelType as string];
        if (!meta) return null;
        const mw = Math.round(Number(r.generation) || 0);
        return {
          code: r.fuelType as string,
          name: `${meta.name} (${meta.country})`,
          country: meta.country,
          mw,
          dir: mw > 20 ? 'import' : mw < -20 ? 'export' : 'idle',
        } as Interconnector;
      })
      .filter((x): x is Interconnector => x !== null)
      .sort((a, b) => Math.abs(b.mw) - Math.abs(a.mw));
  } catch (err) {
    console.warn('[grid] interconnectors unavailable:', (err as Error).message);
    return [];
  }
}

const GRID_TTL_MS = 5 * 60 * 1000;

export async function getGridSnapshot(): Promise<GridSnapshot> {
  const cached = cache.get<GridSnapshot>('grid-snapshot');
  if (cached) return cached;

  const [ni, mix, regs, ints] = await Promise.all([
    nationalIntensity(),
    nationalMix(),
    regions(),
    interconnectors(),
  ]);

  const sources: SourceRef[] = [];
  if (ni.intensity != null || mix.length || regs.length) sources.push(CARBON_SOURCE);
  if (ints.length) sources.push(ELEXON_SOURCE);

  const snapshot: GridSnapshot = {
    asOf: new Date().toISOString(),
    national: { intensity: ni.intensity, index: ni.index, mix },
    regions: regs,
    interconnectors: ints,
    sources,
  };
  // Don't cache an empty/failed snapshot for the full TTL — let the next request retry.
  const hasData = snapshot.regions.length > 0 || snapshot.interconnectors.length > 0 || snapshot.national.intensity != null;
  if (hasData) cache.set('grid-snapshot', snapshot, GRID_TTL_MS);
  return snapshot;
}
