export interface SourceRef {
  name: string;
  url: string;
  /** Attribution text we MUST display where this data appears (e.g. Elexon BMRS terms). */
  attribution?: string;
}

export interface SeriesPoint {
  t: string; // ISO date
  v: number;
}

export interface Metric {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  /** % change vs the previous comparable period (e.g. day-on-day). */
  changePct?: number | null;
  /** Short recent history for a sparkline / mini chart. */
  series?: SeriesPoint[];
  /** Plain-English "what this means" — may be filled by AI in the daily job. */
  meaning?: string;
  sourceName: string;
}

export interface FuelShare {
  fuel: string;
  pct: number;
}

export interface MarketSnapshot {
  asOf: string;
  metrics: Metric[];
  generationMix: FuelShare[];
  sources: SourceRef[];
}

/** Each market-data source implements this. The aggregator merges them. */
export interface MarketDataProvider {
  readonly name: string;
  getPartial(): Promise<{
    metrics: Metric[];
    sources: SourceRef[];
    generationMix?: FuelShare[];
  }>;
}
