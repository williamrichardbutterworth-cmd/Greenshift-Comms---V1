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

// ── Cost-comparison datasets ──
export interface QuoteRow {
  id: string;
  supplier: string;
  term: string;          // e.g. "36-month fixed"
  unitRate: string;      // p/kWh (kept as a string for grid editing)
  standing: string;      // p/day
  recommended?: boolean; // exactly one row is the recommendation
}
export interface CurrentPosition {
  supplier: string;
  product: string;       // e.g. "Out-of-contract / deemed"
  unitRate: string;      // p/kWh
  standing: string;      // p/day
  termStatus: string;    // e.g. "Expires 31 Aug"
}
export interface CostData {
  current: CurrentPosition;
  quotes: QuoteRow[];
}

export interface ReportData {
  cost?: CostData;
  // procure-ahead datasets land here in Phase 2 (forwardCurveId, etc.)
}

// The persisted report instance (stored on the project's `inputs` jsonb).
export interface ReportState {
  templateId: string;
  clientProfileId?: string;
  title: string;
  values: Record<string, string>;   // editable token values (meta + narrative + bound text)
  data: ReportData;
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
  seed(client: ClientProfile | null): ReportState;
  compute(state: ReportState, client: ClientProfile | null): ComputeResult;
  excel?(state: ReportState, client: ClientProfile | null): Promise<Blob>;
}
