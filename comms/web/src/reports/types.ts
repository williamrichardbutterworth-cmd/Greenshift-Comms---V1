import type { ClientProfile } from '../lib/api';

// ── Report engine: shared types ──
// A report is a CHOSEN TEMPLATE + a CLIENT + editable token values + structured
// datasets (e.g. the supplier-quote grid). Each template is a self-contained module
// (HTML with {{tokens}} + a field manifest + seed/compute). Adding a new template the
// user sends over is one new module — no freeform editor, no schema change.

export type FieldType = 'text' | 'multiline' | 'currency' | 'number' | 'percent' | 'date' | 'email';

export interface TemplateField {
  key: string;
  label: string;
  group: string;
  type: FieldType;
  /** Auto-filled from the client record (shown with a "from client" hint). */
  bound?: boolean;
  /** AI may draft this narrative field. */
  ai?: boolean;
  /** Derived from a dataset (the quotes grid) — read-only in the field list. */
  computed?: boolean;
  help?: string;
  placeholder?: string;
  /** Render full-width in the data panel (multiline / long text). */
  full?: boolean;
}

export type ReportKind = 'cost-comparison' | 'procure-ahead';

// ── Cost-comparison datasets (multi-meter, day/night) ──
// A comparison is built around the client's actual METERS. Each meter carries its own
// current supplier + day/night consumption & rates + standing charge (single-rate meters
// simply leave the night band blank). One or more PROPOSED suppliers then quote new rates
// against the SAME consumption, so every annual cost is like-for-like — mirroring the
// branded Excel (a "current" block + a green proposed block per supplier).
export interface MeterLine {
  id: string;
  meterNumber: string;        // MPAN (electric) / MPRN (gas)
  fuel: 'electric' | 'gas';
  site: string;               // site address / label
  currentSupplier: string;
  dayConsumption: string;     // annual kWh (single-rate meters put all usage here)
  dayRate: string;            // p/kWh
  nightConsumption: string;   // annual kWh ('' / 0 = single-rate, no night band)
  nightRate: string;          // p/kWh
  standing: string;           // p/day
}
// One proposed supplier's quoted rates for a single meter — the meter's consumption is
// reused, only the rates differ (like-for-like).
export interface SupplierLine {
  dayRate: string;            // p/kWh
  nightRate: string;          // p/kWh
  standing: string;           // p/day
}
export interface ProposedSupplier {
  id: string;
  name: string;
  term: string;               // optional contract length, e.g. "36-month fixed"
  lines: Record<string, SupplierLine>; // keyed by MeterLine.id
  recommended?: boolean;      // exactly one supplier is the recommendation (else cheapest)
}
export interface CostData {
  meters: MeterLine[];
  proposed: ProposedSupplier[];
  // Legacy single-position fields — kept optional so reports saved under the old
  // (single-rate, single-supplier) shape still parse and migrate forward.
  current?: CurrentPosition;
  quotes?: QuoteRow[];
}
// Legacy shapes (retained for migration of older saved reports).
export interface QuoteRow {
  id: string;
  supplier: string;
  term: string;
  unitRate: string;
  standing: string;
  recommended?: boolean;
}
export interface CurrentPosition {
  supplier: string;
  product: string;
  unitRate: string;
  standing: string;
  termStatus: string;
}

// ── Procure-ahead datasets (live market figures + forward-curve read) ──
export interface ProcureCard {
  value: string;       // the headline number (unit comes from the template)
  deltaText: string;   // e.g. "£7 (8%)"
  dir: 'down' | 'up' | 'flat';
}
export interface ProcureData {
  asOf: string;
  frontYearPower: ProcureCard;
  dayAheadPower: ProcureCard;
  gas: ProcureCard;
  brent: ProcureCard;
  /** The power forward curve (the dashboard's curve): each forward delivery period + price. */
  curveLegs: { label: string; value: number }[];
  curveUnit: string;
  signal: 'backwardation' | 'value' | 'contango' | '';
  curveAsOf?: string;
}

export interface ReportData {
  cost?: CostData;
  procure?: ProcureData;
}

// The persisted report instance (stored on the project's `inputs` jsonb).
export interface ReportState {
  templateId: string;
  clientProfileId?: string;
  title: string;
  values: Record<string, string>;   // editable token values (meta + narrative + bound text)
  data: ReportData;
  /** Inline edits made directly on the A4 page — the report's `.sheet` body HTML
   * (blocks + manual page breaks). When set, it overrides the template render until
   * the user resets to the template. */
  editedHtml?: string;
}

// Headline facts a template exposes — drives the studio header and the email handoff.
export interface ReportSummary {
  headline: string;
  facts: { label: string; value: string }[];
}

export interface ComputeResult {
  tokens: Record<string, string>;
  lists: Record<string, Array<Record<string, string>>>;
  summary: ReportSummary;
}

// A two-way binding between a report field and the client record (the single source
// of truth). On open, `read` derives the live value from the client; on edit, `write`
// produces the client-inputs patch so the change propagates everywhere.
export interface BoundField {
  key: string;          // report field key bound to a client-record field
  read: (inputs: Record<string, unknown>) => string;
  write: (value: string) => Record<string, string>;
  /** Derive from the client on open, but never write back (e.g. a value parsed/
   * reformatted from a different client field, where a round-trip would distort it). */
  readOnly?: boolean;
}

// A report template = its HTML + field manifest + seed/compute. Optional excel().
export interface ReportTemplate {
  id: string;
  kind: ReportKind;
  name: string;
  description: string;
  accent: string;        // tailwind class for the picker card icon
  html: string;          // the full standalone HTML document, with {{tokens}}
  fields: TemplateField[];
  groups: string[];      // field-group display order
  /** Fields that mirror the client record, kept in sync two-way by the studio. */
  boundFields?: BoundField[];
  seed(client: ClientProfile | null): ReportState;
  compute(state: ReportState, client: ClientProfile | null): ComputeResult;
  excel?(state: ReportState, client: ClientProfile | null): Promise<Blob>;
}
