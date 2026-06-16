import type {
  ReportDoc, DocNode, MarketSnapshot, NewsRef, CustomChartData, SeriesKey, RangeKey, SectionSpec,
} from './api';

// Deterministically materialise a TipTap document from an ordered list of
// section specs. The AI only ever returns these specs (text bodies + named
// embeds); the client owns all data and builds the real document here — so the
// model can never fabricate a figure, an `embed` just names a slot to fill.

export type { SectionSpec } from './api';

export interface BuildContext {
  snapshot?: MarketSnapshot | null;
  selectedNews?: NewsRef[];
  customCharts?: Record<string, CustomChartData>;
}

const MAX_SECTIONS = 16;

// Fallback labels/units for a freshly-embedded price chart; the chart node
// overwrites these from the live series as soon as it loads its points.
const SERIES_FALLBACK: Record<string, { label: string; unit: string }> = {
  brent: { label: 'Brent crude', unit: '$/bbl' },
  gas: { label: 'UK gas — System Average Price', unit: 'p/therm' },
  power: { label: 'UK power — day-ahead', unit: '£/MWh' },
};

const headingNode = (text: string): DocNode => ({
  type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }],
});

// Split prose into paragraphs on blank lines; single newlines become hard breaks.
export function textToNodes(body: string): DocNode[] {
  const paras = (body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return [{ type: 'paragraph' }];
  return paras.map((para) => {
    const lines = para.split(/\n/);
    const content: DocNode[] = [];
    lines.forEach((ln, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      if (ln) content.push({ type: 'text', text: ln });
    });
    return { type: 'paragraph', content };
  });
}

function metricsNode(snapshot: MarketSnapshot): DocNode {
  return {
    type: 'metricsTable',
    attrs: {
      rows: snapshot.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit, changePct: m.changePct })),
      asOf: new Date(snapshot.asOf).toLocaleString('en-GB'),
    },
  };
}
function chartNode(series: SeriesKey, range: RangeKey): DocNode {
  const f = SERIES_FALLBACK[series] ?? { label: series, unit: '' };
  return { type: 'priceChart', attrs: { chart: { series, range, label: f.label, unit: f.unit, points: [] } } };
}

function embedNode(ref: string, ctx: BuildContext): DocNode | null {
  if (ref === 'marketSnapshot') return ctx.snapshot ? metricsNode(ctx.snapshot) : null;
  if (ref === 'generationMap') return { type: 'gridMap', attrs: { snapshot: null, mode: 'intensity' } };
  if (ref === 'forwardCurve') return { type: 'forwardCurve', attrs: { snapshot: null } };
  if (ref === 'selectedNews') return ctx.selectedNews?.length ? { type: 'newsList', attrs: { items: ctx.selectedNews } } : null;
  if (ref.startsWith('chart:')) {
    const [, series, range] = ref.split(':');
    if (!series) return null;
    return chartNode(series as SeriesKey, (range as RangeKey) || '12m');
  }
  if (ref.startsWith('customChart:')) {
    const id = ref.slice('customChart:'.length);
    const data = ctx.customCharts?.[id];
    return data ? { type: 'customChart', attrs: { data } } : null;
  }
  return null;
}

export function buildDocFromSections(sections: SectionSpec[], ctx: BuildContext): ReportDoc {
  const content: DocNode[] = [];
  for (const s of (sections ?? []).slice(0, MAX_SECTIONS)) {
    if (s.kind === 'text') {
      if (s.heading) content.push(headingNode(s.heading));
      content.push(...textToNodes(s.body));
    } else {
      const node = embedNode(s.ref, ctx);
      if (!node) continue; // drop unknown/unavailable embeds (and their heading)
      if (s.heading) content.push(headingNode(s.heading));
      content.push(node);
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}
