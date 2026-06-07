import { useEffect, useState } from 'react';
import {
  Sparkles, Download, FileText, Info, Plus, Trash2, ChevronUp, ChevronDown,
  Type, Table2, LineChart as LineChartIcon, Newspaper,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  api,
  type NewsItem, type ReportInputs, type MarketSnapshot, type ReportBlock,
  type SeriesMeta, type SeriesKey, type RangeKey,
} from '../lib/api';

const FIELDS: { key: keyof ReportInputs; label: string; placeholder: string }[] = [
  { key: 'companyName', label: 'Company', placeholder: 'Acme Manufacturing Ltd' },
  { key: 'clientName', label: 'Contact name', placeholder: 'Jane Smith' },
  { key: 'contact', label: 'Contact detail', placeholder: 'jane@acme.co.uk' },
  { key: 'sites', label: 'Sites / meters', placeholder: '3 sites · 4 MPANs' },
  { key: 'currentSupplier', label: 'Current supplier', placeholder: 'British Gas' },
  { key: 'contractEnd', label: 'Contract end', placeholder: 'Sep 2026' },
  { key: 'consumption', label: 'Annual consumption', placeholder: '450,000 kWh' },
];

const RANGES: { k: RangeKey; label: string }[] = [
  { k: '3m', label: '3 months' },
  { k: '6m', label: '6 months' },
  { k: '12m', label: '12 months' },
];

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const TYPE_META: Record<ReportBlock['type'], { label: string; icon: typeof Type }> = {
  text: { label: 'Text', icon: Type },
  metrics: { label: 'Metrics', icon: Table2 },
  chart: { label: 'Chart', icon: LineChartIcon },
  news: { label: 'News', icon: Newspaper },
};

function metricsBlockFrom(snapshot: MarketSnapshot, heading = 'Market snapshot'): ReportBlock {
  return {
    id: uid(),
    type: 'metrics',
    heading,
    rows: snapshot.metrics.map((m) => ({ label: m.label, value: m.value, unit: m.unit, changePct: m.changePct })),
    asOf: new Date(snapshot.asOf).toLocaleString('en-GB'),
  };
}
function newsBlockFrom(items: NewsItem[], heading = 'Supporting evidence'): ReportBlock {
  return { id: uid(), type: 'news', heading, items: items.map((n) => ({ source: n.source, title: n.title, url: n.url })) };
}

export function ReportGenerator() {
  const [inputs, setInputs] = useState<ReportInputs>({});
  const [news, setNews] = useState<NewsItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [provider, setProvider] = useState<string>('');
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [seriesMeta, setSeriesMeta] = useState<SeriesMeta[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.news(10).then(setNews).catch(() => setNews([]));
    api.marketSeries().then(setSeriesMeta).catch(() => setSeriesMeta([]));
  }, []);

  const set = (k: keyof ReportInputs, v: string) => setInputs((s) => ({ ...s, [k]: v }));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectedNews = () => news.filter((n) => selected.has(n.id));

  // ── block ops ──
  const move = (id: string, dir: -1 | 1) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const setHeading = (id: string, heading: string) =>
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, heading } : b)));
  const setText = (id: string, body: string) =>
    setBlocks((bs) => bs.map((b) => (b.id === id && b.type === 'text' ? { ...b, body } : b)));
  const removeNewsItem = (id: string, idx: number) =>
    setBlocks((bs) => bs.map((b) => (b.id === id && b.type === 'news' ? { ...b, items: b.items.filter((_, i) => i !== idx) } : b)));

  const toggleMetric = (id: string, label: string) =>
    setBlocks((bs) =>
      bs.map((b) => {
        if (b.id !== id || b.type !== 'metrics' || !snapshot) return b;
        const has = b.rows.some((r) => r.label === label);
        let rows = has
          ? b.rows.filter((r) => r.label !== label)
          : [...b.rows, (() => { const m = snapshot.metrics.find((x) => x.label === label)!; return { label: m.label, value: m.value, unit: m.unit, changePct: m.changePct }; })()];
        const order = new Map(snapshot.metrics.map((m, i) => [m.label, i] as const));
        rows = rows.slice().sort((a, c) => (order.get(a.label) ?? 0) - (order.get(c.label) ?? 0));
        return { ...b, rows };
      }),
    );

  const loadChart = async (id: string, series: SeriesKey, range: RangeKey) => {
    try {
      const h = await api.marketHistory(series, range);
      setBlocks((bs) =>
        bs.map((b) =>
          b.id === id && b.type === 'chart'
            ? { ...b, chart: { series: h.key, label: h.label, unit: h.unit, range: h.range, points: h.points, sourceName: h.sourceName } }
            : b,
        ),
      );
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  const addText = () => setBlocks((bs) => [...bs, { id: uid(), type: 'text', heading: 'New section', body: '' }]);
  const addMetrics = () => snapshot && setBlocks((bs) => [...bs, metricsBlockFrom(snapshot, 'Market data')]);
  const addNews = () => setBlocks((bs) => [...bs, newsBlockFrom(selectedNews(), 'Supporting evidence')]);
  const addChart = () => {
    const id = uid();
    setBlocks((bs) => [...bs, { id, type: 'chart', heading: 'Price trend', chart: { series: 'brent', label: 'Brent crude', unit: '$/bbl', range: '12m', points: [] } }]);
    loadChart(id, 'brent', '12m');
  };

  const draft = async () => {
    setDrafting(true);
    setErr(null);
    try {
      const sel = selectedNews();
      const res = await api.draftReport(inputs, sel);
      setSnapshot(res.snapshot);
      setProvider(res.provider);
      const n = res.narrative;
      setBlocks([
        { id: uid(), type: 'text', heading: 'Executive summary', body: n.executiveSummary },
        { id: uid(), type: 'text', heading: 'Market context', body: n.marketContext },
        metricsBlockFrom(res.snapshot),
        { id: uid(), type: 'text', heading: 'Outlook', body: n.outlook },
        { id: uid(), type: 'text', heading: 'Our recommendation', body: n.recommendation },
        ...(sel.length ? [newsBlockFrom(sel)] : []),
      ]);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setDrafting(false);
    }
  };

  const download = async (fmt: 'pdf' | 'docx') => {
    if (!blocks.length) return;
    setExporting(fmt);
    setErr(null);
    try {
      const meta = {
        asOf: snapshot?.asOf,
        attributions: (snapshot?.sources ?? []).filter((s) => s.attribution).map((s) => s.attribution!),
      };
      const exp = await import('../lib/exportReport'); // lazy-load heavy PDF/Word libs
      const { blob, filename } = fmt === 'pdf'
        ? await exp.exportReportPdf(inputs, blocks, meta)
        : await exp.exportReportDocx(inputs, blocks, meta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      {/* Left: inputs + evidence */}
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold mb-3">New client report</h2>
          <div className="space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label block mb-1">{f.label}</label>
                <input className="input" placeholder={f.placeholder} value={inputs[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
              </div>
            ))}
            <div>
              <label className="label block mb-1">Notes / your projections</label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Anything specific to weave in (budget, risk appetite, renewal goals)…"
                value={inputs.agentNotes ?? ''}
                onChange={(e) => set('agentNotes', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <h3 className="label mb-2">Attach evidence (news)</h3>
          <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
            {news.map((n) => (
              <label key={n.id} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-1 accent-brand-green" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                <span><span className="text-brand-greenDark">{n.source}:</span> {n.title}</span>
              </label>
            ))}
            {!news.length && <p className="text-sm text-brand-muted">No news loaded.</p>}
          </div>
        </div>

        <button className="btn-primary w-full" onClick={draft} disabled={drafting}>
          <Sparkles size={16} /> {drafting ? 'Drafting…' : blocks.length ? 'Re-draft with AI' : 'Draft with AI'}
        </button>
      </div>

      {/* Right: customisable block editor + export */}
      <div className="space-y-4">
        {err && <p className="text-sm text-up">{err}</p>}

        {!blocks.length && !err && (
          <div className="card p-8 text-center text-brand-muted">
            <FileText size={28} className="mx-auto mb-2 opacity-50" />
            Fill in the client details, attach any relevant news, then draft with AI.
            <br />
            You can then add, reorder, edit or remove any section — including live price charts — before exporting.
          </div>
        )}

        {blocks.length > 0 && (
          <>
            <div className="card p-3 flex gap-2 items-start bg-brand-tint border-brand-line">
              <Info size={16} className="text-brand-greenDark mt-0.5 shrink-0" />
              <p className="text-sm text-brand-ink">
                {provider === 'none'
                  ? 'AI not configured — text sections are placeholders. Edit them, add blocks, then export.'
                  : `Drafted by ${provider}. Add / reorder / edit any block, then review before sending.`}
              </p>
            </div>

            {blocks.map((b, i) => {
              const Icon = TYPE_META[b.type].icon;
              return (
                <div key={b.id} className="card p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-brand-greenDark bg-brand-tint px-1.5 py-0.5 rounded shrink-0">
                      <Icon size={11} /> {TYPE_META[b.type].label}
                    </span>
                    <input
                      className="input flex-1 !py-1 font-medium"
                      value={b.heading}
                      onChange={(e) => setHeading(b.id, e.target.value)}
                    />
                    <div className="flex gap-0.5 shrink-0">
                      <button className="btn-ghost !px-1.5 !py-1" onClick={() => move(b.id, -1)} disabled={i === 0} title="Move up"><ChevronUp size={15} /></button>
                      <button className="btn-ghost !px-1.5 !py-1" onClick={() => move(b.id, 1)} disabled={i === blocks.length - 1} title="Move down"><ChevronDown size={15} /></button>
                      <button className="btn-ghost !px-1.5 !py-1 hover:text-up" onClick={() => remove(b.id)} title="Remove"><Trash2 size={15} /></button>
                    </div>
                  </div>

                  {b.type === 'text' && (
                    <textarea className="input min-h-[110px] leading-relaxed" value={b.body} onChange={(e) => setText(b.id, e.target.value)} />
                  )}

                  {b.type === 'metrics' && snapshot && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {snapshot.metrics.map((m) => (
                          <label key={m.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input type="checkbox" className="accent-brand-green" checked={b.rows.some((r) => r.label === m.label)} onChange={() => toggleMetric(b.id, m.label)} />
                            {m.label}
                          </label>
                        ))}
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {b.rows.map((r) => (
                            <tr key={r.label} className="border-b border-brand-line/60">
                              <td className="py-1">{r.label}</td>
                              <td className="py-1 text-right font-mono">{r.value ?? '—'} <span className="text-brand-muted text-xs">{r.unit}</span></td>
                              <td className={'py-1 text-right font-mono text-xs ' + ((r.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>
                                {r.changePct == null ? '' : (r.changePct > 0 ? '+' : '') + r.changePct + '%'}
                              </td>
                            </tr>
                          ))}
                          {!b.rows.length && <tr><td className="py-2 text-brand-muted text-xs">No metrics selected.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {b.type === 'chart' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <select className="input !py-1 !w-auto text-sm" value={b.chart.series} onChange={(e) => loadChart(b.id, e.target.value as SeriesKey, b.chart.range)}>
                          {(seriesMeta.length ? seriesMeta : [{ key: b.chart.series, label: b.chart.label, unit: b.chart.unit }]).map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </select>
                        <select className="input !py-1 !w-auto text-sm" value={b.chart.range} onChange={(e) => loadChart(b.id, b.chart.series, e.target.value as RangeKey)}>
                          {RANGES.map((r) => <option key={r.k} value={r.k}>{r.label}</option>)}
                        </select>
                      </div>
                      <div className="h-48 rounded-lg border border-brand-line p-2">
                        {b.chart.points.length > 1 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={b.chart.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                              <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={48} tickFormatter={(t) => String(t).slice(2, 7)} />
                              <YAxis tick={{ fontSize: 10 }} width={40} domain={['auto', 'auto']} />
                              <Tooltip contentStyle={{ fontSize: 12 }} />
                              <Line type="monotone" dataKey="v" stroke="#40A800" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full grid place-items-center text-sm text-brand-muted">Loading chart…</div>
                        )}
                      </div>
                      {b.chart.points.length > 1 && (
                        <p className="text-xs text-brand-muted">
                          {b.chart.label} ({b.chart.unit}) · {b.chart.points[0].t} → {b.chart.points[b.chart.points.length - 1].t} · Source: {b.chart.sourceName}
                        </p>
                      )}
                    </div>
                  )}

                  {b.type === 'news' && (
                    <div className="space-y-1">
                      {b.items.map((it, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          <span className="flex-1"><span className="text-brand-greenDark">{it.source}:</span> {it.title}</span>
                          <button className="btn-ghost !px-1 !py-0.5 hover:text-up shrink-0" onClick={() => removeNewsItem(b.id, idx)} title="Remove"><Trash2 size={13} /></button>
                        </div>
                      ))}
                      {!b.items.length && <p className="text-xs text-brand-muted">No items — tick news on the left, then re-add a News block.</p>}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add block */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="label">Add block:</span>
              <button className="btn-ghost" onClick={addText}><Plus size={14} /> Text</button>
              <button className="btn-ghost" onClick={addMetrics} disabled={!snapshot}><Plus size={14} /> Metrics</button>
              <button className="btn-ghost" onClick={addChart}><Plus size={14} /> Price chart</button>
              <button className="btn-ghost" onClick={addNews}><Plus size={14} /> News</button>
            </div>

            {/* Export */}
            <div className="flex gap-2 pt-2 border-t border-brand-line">
              <button className="btn-primary" onClick={() => download('pdf')} disabled={!!exporting}>
                <Download size={16} /> {exporting === 'pdf' ? 'Building PDF…' : 'Download PDF'}
              </button>
              <button className="btn-ghost" onClick={() => download('docx')} disabled={!!exporting}>
                <FileText size={16} /> {exporting === 'docx' ? 'Building Word…' : 'Download Word'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
