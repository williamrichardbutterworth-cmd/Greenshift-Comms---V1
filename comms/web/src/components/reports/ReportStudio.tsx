import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileDown, Sheet, Code2, Printer, Loader2, Sparkles, Check, ChevronDown, RefreshCw, TrendingDown, TrendingUp, Mail, Copy, X, Pencil,
} from 'lucide-react';
import { api, type ReportProject, type ReportInputs, type ClientProfile } from '../../lib/api';
import { getReportTemplate } from '../../reports/registry';
import { renderTemplate, annualCost, parseNum, money0 } from '../../reports/engine';
import { stateFromProject, patchFromState } from '../../reports/state';
import { loadProcureData } from '../../reports/templates/procureAhead';
import type { ReportState, CostData, CurrentPosition, TemplateField, ProcureData, ReportTemplate } from '../../reports/types';
import { downloadHtml, download, slug } from '../../reports/export';
import { QuotesGrid } from './QuotesGrid';
import { ReportEditor, type ReportEditorHandle } from './ReportEditor';

const EMPTY_CURRENT: CurrentPosition = { supplier: '', product: '', unitRate: '', standing: '', termStatus: '' };

export function ReportStudio({ project, onProjectSaved }: {
  project: ReportProject;
  onProjectSaved: (p: ReportProject) => void;
}) {
  const [state, setState] = useState<ReportState>(() => stateFromProject(project) ?? blankState(project));
  const template = getReportTemplate(state.templateId);
  // Freshest state/project for the unmount flush (refs so the cleanup never reads a stale copy).
  const stateRef = useRef(state); stateRef.current = state;
  const projectRef = useRef(project); projectRef.current = project;
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx' | 'ai' | 'market'>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [email, setEmail] = useState<null | { loading?: boolean; subject?: string; body?: string; error?: string; logged?: boolean }>(null);
  const [pageCount, setPageCount] = useState(1);
  const editorRef = useRef<ReportEditorHandle>(null);
  // Two-way binding to the client record (single source of truth).
  const [client, setClient] = useState<ClientProfile | null>(null);
  const clientRef = useRef<ClientProfile | null>(null); // freshest client for write-back merges
  useEffect(() => { clientRef.current = client; }, [client]);
  const pendingClient = useRef<Record<string, string>>({});

  // ── derived ──
  const cost: CostData = state.data.cost ?? { current: { ...EMPTY_CURRENT }, quotes: [] };
  const kwh = parseNum(state.values.annualKwh);
  const currentCost = annualCost(parseNum(cost.current.unitRate), parseNum(cost.current.standing), kwh);
  const computed = useMemo(() => template?.compute(state, null) ?? null, [template, state]);
  const html = useMemo(
    () => (template && computed ? renderTemplate(template.html, computed.tokens, computed.lists) : ''),
    [template, computed],
  );

  // ── autosave (+ flush two-way client-record writes) ──
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    setSaveState('saving');
    const t = setTimeout(async () => {
      try {
        const saved = await api.projects.update(project.id, patchFromState(state));
        onProjectSaved(saved);
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1400);
      } catch { setSaveState('idle'); }
      // Flush queued client-record write-backs against the FRESHEST client. Only the
      // keys we successfully write are cleared, so edits made during the await (or a
      // failed write) survive for the next flush — no silent divergence.
      const patch = { ...pendingClient.current };
      if (state.clientProfileId && Object.keys(patch).length) {
        try {
          const cur = clientRef.current ?? await api.profiles.get(state.clientProfileId);
          const updated = await api.profiles.update(state.clientProfileId, { inputs: { ...cur.inputs, ...patch } as ReportInputs });
          for (const k of Object.keys(patch)) if (pendingClient.current[k] === patch[k]) delete pendingClient.current[k];
          clientRef.current = updated; setClient(updated);
        } catch { /* keep pending keys; a later edit/save retries them */ }
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // On open, mirror the live client record into the bound fields (client wins where it
  // has a value, so reports reflect the latest data without wiping report-only edits).
  useEffect(() => {
    if (!state.clientProfileId || !template) return;
    let cancelled = false;
    api.profiles.get(state.clientProfileId).then((c) => {
      if (cancelled) return;
      clientRef.current = c; setClient(c);
      // Only mark dirty if the live record actually changed a bound field — so just
      // opening a report doesn't bump its timestamp / reorder the recent list.
      setState((s) => { const next = applyBound(s, template, c.inputs as Record<string, unknown>); if (next !== s) dirty.current = true; return next; });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [state.clientProfileId, template?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = useCallback((fn: (s: ReportState) => ReportState) => { dirty.current = true; setState(fn); }, []);
  // Queue a write-back to the client record when a bound field is edited.
  const queueBound = (key: string, v: string) => {
    const bf = template?.boundFields?.find((b) => b.key === key);
    if (bf && !bf.readOnly) Object.assign(pendingClient.current, bf.write(v));
  };
  const setValue = (k: string, v: string) => { queueBound(k, v); mutate((s) => ({ ...s, values: { ...s.values, [k]: v } })); };
  const setTitle = (v: string) => mutate((s) => ({ ...s, title: v }));
  const setCurrent = (patch: Partial<CurrentPosition>) => {
    Object.entries(patch).forEach(([sub, val]) => queueBound(`current.${sub}`, val as string));
    mutate((s) => ({ ...s, data: { ...s.data, cost: { current: { ...EMPTY_CURRENT, ...s.data.cost?.current, ...patch }, quotes: s.data.cost?.quotes ?? [] } } }));
  };
  const setQuotes = (quotes: CostData['quotes']) =>
    mutate((s) => ({ ...s, data: { ...s.data, cost: { current: s.data.cost?.current ?? { ...EMPTY_CURRENT }, quotes } } }));
  const setProcure = (procure: ProcureData) => mutate((s) => ({ ...s, data: { ...s.data, procure } }));

  // Procure-ahead: pull the live market figures + forward-curve read on first open.
  useEffect(() => {
    if (template?.kind !== 'procure-ahead' || state.data.procure) return;
    let cancelled = false;
    setBusy('market');
    loadProcureData().then((p) => { if (!cancelled) setProcure(p); }).finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [template?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshMarket = async () => {
    setBusy('market');
    try { setProcure(await loadProcureData()); } finally { setBusy(null); }
  };

  // ── flush on unmount ──
  // Switching document tabs unmounts this studio, and both debounce windows (editor 280ms,
  // autosave 800ms) would otherwise be cancelled — dropping the most recent edit. We push the
  // latest state into the in-memory workspace session synchronously (so a remount restores it)
  // and fire a durable save in the background. One-shot: the editor's page-edit flush and this
  // studio's field-edit flush can both fire during the same teardown; whichever runs first wins.
  const flushed = useRef(false);
  const persistNow = useCallback((body?: string) => {
    if (flushed.current) return;
    // A page-edit flush (body provided) always persists — the edit may not have emitted yet,
    // so `dirty` can still be false. A field-only flush requires a pending change.
    if (body == null && !dirty.current) return;
    flushed.current = true;
    const base = stateRef.current;
    // The editor only passes a body when the page was genuinely edited, so adopt it
    // unconditionally (covers even a first keystroke made and switched away inside the debounce
    // window). No body → just flush the field edits already sitting in state.
    const latest: ReportState = body != null ? { ...base, editedHtml: body } : base;
    const proj = projectRef.current;
    onProjectSaved({ ...proj, name: latest.title, inputs: latest as unknown as ReportInputs });
    api.projects.update(proj.id, patchFromState(latest)).catch(() => {});
  }, [onProjectSaved]);
  const persistRef = useRef(persistNow); persistRef.current = persistNow;
  useEffect(() => () => persistRef.current(), []); // field-only edits (no page edit) on unmount

  if (!template) {
    return <div className="card p-10 text-center text-brand-muted">This report’s template isn’t available. It may have been renamed or removed.</div>;
  }
  const fieldsFor = (group: string) => template.fields.filter((f) => f.group === group);
  const aiGroup = template.kind === 'cost-comparison' ? 'Recommendation' : 'Outlook';
  const aiGroupTitle = template.kind === 'cost-comparison' ? 'Narrative & recommendation' : 'Outlook & our view';

  const fileBase = slug(state.title);
  // Inline page edits → stored as the editedHtml override; the data panel pre-fills the
  // report, but once you edit the page directly your edits win until you reset.
  const setEditedBody = useCallback((body: string) => mutate((s) => ({ ...s, editedHtml: body })), [mutate]);
  const resetToTemplate = () => mutate((s) => ({ ...s, editedHtml: undefined }));

  const exportPdf = async () => {
    setExportOpen(false); setBusy('pdf');
    try { await editorRef.current?.exportPdf(`${fileBase}.pdf`); logDoc('Generated PDF report'); }
    catch { /* surfaced by the disabled state lifting */ } finally { setBusy(null); }
  };
  const exportXlsx = async () => {
    setExportOpen(false); setBusy('xlsx');
    try {
      if (template.excel) { const blob = await template.excel(state, null); download(blob, `${fileBase}.xlsx`); logDoc('Generated Excel comparison'); }
    } catch { /* no-op */ } finally { setBusy(null); }
  };
  const exportHtml = () => { setExportOpen(false); downloadHtml(editorRef.current?.getDocHtml() ?? html, `${fileBase}.html`); };
  const doPrint = () => { setExportOpen(false); editorRef.current?.print(); };

  const logDoc = (title: string) => {
    if (state.clientProfileId) api.profiles.addActivity(state.clientProfileId, { type: 'document', title: `${title} — ${state.title}` }).catch(() => {});
  };

  // Hand the report off to the email assistant: draft a covering email seeded with
  // the report's headline facts, grounded in the client record.
  const draftCoveringEmail = async () => {
    setExportOpen(false);
    if (!state.clientProfileId) { setEmail({ error: 'Attach this report to a client to draft a covering email.' }); return; }
    setEmail({ loading: true });
    try {
      const client = await api.profiles.get(state.clientProfileId);
      const sum = computed?.summary;
      const facts = (sum?.facts ?? []).map((f) => `${f.label}: ${f.value}`).join('; ');
      const instruction = `I have prepared a ${template.name} ("${state.title}") to send to this client. Headline: ${sum?.headline ?? ''}. Key figures: ${facts}. Write a short, warm covering email that introduces the report I'm attaching, states the headline outcome plainly, and proposes a brief call to walk through it.`;
      const res = await api.email.draft({ inputs: client.inputs, history: [], mode: 'follow-up', instruction, angles: [] });
      setEmail({ subject: res.subject, body: res.body, error: res.error });
    } catch (e) { setEmail({ error: String((e as Error).message) }); }
  };
  const logEmailToClient = async () => {
    if (!state.clientProfileId || !email?.body) return;
    try { await api.profiles.addActivity(state.clientProfileId, { type: 'email-sent', title: email.subject || 'Covering email', detail: email.body }); setEmail((e) => (e ? { ...e, logged: true } : e)); } catch { /* no-op */ }
  };

  const aiDraft = async () => {
    setBusy('ai');
    try {
      const res = await api.reports.draftNarrative({
        kind: template.kind,
        clientProfileId: state.clientProfileId,
        facts: computed?.summary.facts ?? [],
        values: state.values,
      });
      if (res.values && Object.keys(res.values).length) {
        mutate((s) => ({ ...s, values: { ...s.values, ...res.values } }));
      }
    } catch { /* degrade silently — fields stay as they are */ } finally { setBusy(null); }
  };

  return (
    <div className="grid xl:grid-cols-[minmax(400px,500px)_1fr] gap-5 items-start">
      {/* ── Data panel ── */}
      <div className="space-y-4 xl:max-h-[calc(100vh-var(--topbar-h)-40px)] xl:overflow-y-auto xl:pr-1 pb-4">
        <section className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={'text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-brand-tint ' + template.accent}>{template.name}</span>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand-muted">
              {saveState === 'saving' ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : saveState === 'saved' ? <><Check size={11} className="text-brand-green" /> Saved</> : 'Autosaves'}
            </span>
          </div>
          <input value={state.title} onChange={(e) => setTitle(e.target.value)} className="input !py-1.5 font-semibold" placeholder="Report title" />

          {/* export bar */}
          <div className="flex items-center gap-2 mt-3">
            <button className="btn-primary !py-1.5 flex-1" onClick={exportPdf} disabled={!!busy}>
              {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} PDF
            </button>
            {template.excel && (
              <button className="btn-ghost !py-1.5" onClick={exportXlsx} disabled={!!busy} title="Download the matching Excel comparison">
                {busy === 'xlsx' ? <Loader2 size={15} className="animate-spin" /> : <Sheet size={15} />} Excel
              </button>
            )}
            <div className="relative">
              <button className="btn-ghost !py-1.5 !px-2" onClick={() => setExportOpen((o) => !o)} title="More export options"><ChevronDown size={15} /></button>
              {exportOpen && (
                <div className="absolute right-0 mt-1 z-20 card p-1 w-48 shadow-lg">
                  <button className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint inline-flex items-center gap-2" onClick={draftCoveringEmail}><Mail size={14} /> Draft covering email</button>
                  <button className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint inline-flex items-center gap-2" onClick={doPrint}><Printer size={14} /> Print / Save PDF</button>
                  <button className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint inline-flex items-center gap-2" onClick={exportHtml}><Code2 size={14} /> Download HTML</button>
                </div>
              )}
            </div>
          </div>
          {state.editedHtml != null && (
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
              <Pencil size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 text-[11px] text-amber-800 leading-snug">You’ve edited the page directly — the fields below no longer drive it.
                <button className="ml-1 font-medium text-brand-greenDark hover:underline" onClick={resetToTemplate}>Reset to template</button> to go back to data-driven.</div>
            </div>
          )}
        </section>

        <Group title="Report details">{fieldsFor('Report').map((f) => <Field key={f.key} f={f} value={state.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />)}</Group>

        <Group title="Client">{fieldsFor('Client').map((f) => <Field key={f.key} f={f} value={state.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />)}</Group>

        {template.kind === 'cost-comparison' && (
          <>
            <section className="card p-4">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="label">Your current position</h3>
                <span className="text-[9px] uppercase tracking-wide text-brand-greenDark/70 bg-brand-tint px-1 rounded">synced to client record</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Inline label="Supplier" value={cost.current.supplier} onChange={(v) => setCurrent({ supplier: v })} placeholder="British Gas" />
                <Inline label="Product" value={cost.current.product} onChange={(v) => setCurrent({ product: v })} placeholder="Out-of-contract / deemed" />
                <Inline label="Unit rate (p/kWh)" value={cost.current.unitRate} onChange={(v) => setCurrent({ unitRate: v })} placeholder="34.50" mono />
                <Inline label="Standing (p/day)" value={cost.current.standing} onChange={(v) => setCurrent({ standing: v })} placeholder="95.00" mono />
                <Inline label="Contract status" value={cost.current.termStatus} onChange={(v) => setCurrent({ termStatus: v })} placeholder="Expires 31 Aug" />
                <div>
                  <label className="text-[11px] text-brand-muted block mb-0.5">Annual cost</label>
                  <div className="input !py-1.5 text-sm font-mono bg-brand-tint/40">{Number.isFinite(currentCost) ? `£${money0(currentCost)}` : '—'}</div>
                </div>
              </div>
            </section>

            <section className="card p-4">
              <h3 className="label mb-2.5">Supplier quotes</h3>
              <QuotesGrid quotes={cost.quotes} annualKwh={kwh} currentCost={currentCost} onChange={setQuotes} />
            </section>
          </>
        )}

        {template.kind === 'procure-ahead' && (
          <section className="card p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="label">Live market data</h3>
              <button className="btn-ghost !py-1 !px-2 text-xs" onClick={refreshMarket} disabled={!!busy} title="Re-pull live figures + the latest forward curve">
                {busy === 'market' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
              </button>
            </div>
            <MarketCards procure={state.data.procure} loading={busy === 'market'} />
          </section>
        )}

        <section className="card p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="label">{aiGroupTitle}</h3>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={aiDraft} disabled={!!busy} title="Draft the narrative from this client + the figures">
              {busy === 'ai' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} AI draft
            </button>
          </div>
          <div className="space-y-2.5">{fieldsFor(aiGroup).map((f) => <Field key={f.key} f={f} value={state.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />)}</div>
        </section>

        <Group title="Footer">{fieldsFor('Footer').map((f) => <Field key={f.key} f={f} value={state.values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} />)}</Group>
      </div>

      {/* ── Editable A4 document ── */}
      <div className="xl:sticky xl:top-[calc(var(--topbar-h)+16px)]">
        <ReportEditor ref={editorRef} html={html} editedBody={state.editedHtml} onChange={setEditedBody} onPageCount={setPageCount} onFlush={persistNow} />
        <div className="text-center text-[11px] text-brand-muted mt-1.5">{pageCount} page{pageCount === 1 ? '' : 's'} · A4</div>
      </div>

      {email && <CoveringEmailModal email={email} onChange={setEmail} onClose={() => setEmail(null)} onLog={logEmailToClient} canLog={!!state.clientProfileId} />}
    </div>
  );
}

function CoveringEmailModal({ email, onChange, onClose, onLog, canLog }: {
  email: { loading?: boolean; subject?: string; body?: string; error?: string; logged?: boolean };
  onChange: (e: { loading?: boolean; subject?: string; body?: string; error?: string; logged?: boolean }) => void;
  onClose: () => void;
  onLog: () => void;
  canLog: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(`Subject: ${email.subject ?? ''}\n\n${email.body ?? ''}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  return (
    <div className="fixed inset-0 z-40 bg-brand-ink/40 grid place-items-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2"><Mail size={17} className="text-brand-greenDark" /> Covering email</h3>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onClose}><X size={16} /></button>
        </div>
        {email.loading ? (
          <p className="text-sm text-brand-muted inline-flex items-center gap-2 py-6"><Loader2 size={15} className="animate-spin" /> Drafting from the report &amp; client…</p>
        ) : email.error ? (
          <p className="text-sm text-up py-4">{email.error}</p>
        ) : (
          <>
            <label className="text-[11px] text-brand-muted block mb-0.5">Subject</label>
            <input className="input !py-1.5 text-sm mb-3" value={email.subject ?? ''} onChange={(e) => onChange({ ...email, subject: e.target.value })} />
            <label className="text-[11px] text-brand-muted block mb-0.5">Body</label>
            <textarea className="input !py-1.5 text-sm h-56 resize-none" value={email.body ?? ''} onChange={(e) => onChange({ ...email, body: e.target.value })} />
            <div className="flex items-center gap-2 mt-3">
              <button className="btn-ghost !py-1.5" onClick={copy}>{copied ? <Check size={15} className="text-brand-green" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}</button>
              {canLog && <button className="btn-primary !py-1.5 ml-auto" onClick={onLog} disabled={email.logged}>{email.logged ? <><Check size={15} /> Logged</> : 'Log to client timeline'}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function blankState(project: ReportProject): ReportState {
  return { templateId: '', clientProfileId: undefined, title: project.name || 'Report', values: {}, data: {} };
}

// Mirror the live client record into the bound fields. A non-empty client value wins
// (so the report reflects the latest data); an empty client value leaves the report's
// own value untouched (no data loss when the client record hasn't been filled yet).
function applyBound(s: ReportState, template: ReportTemplate, inputs: Record<string, unknown>): ReportState {
  let values = s.values;
  let cost = s.data.cost;
  let changed = false;
  for (const b of template.boundFields ?? []) {
    const live = b.read(inputs);
    if (!live || !live.trim()) continue;
    if (b.key.startsWith('current.')) {
      const sub = b.key.slice('current.'.length) as keyof CurrentPosition;
      if ((cost?.current?.[sub] ?? '') === live) continue;
      cost = { current: { ...EMPTY_CURRENT, ...(cost?.current ?? {}), [sub]: live }, quotes: cost?.quotes ?? [] };
      changed = true;
    } else {
      if ((values[b.key] ?? '') === live) continue;
      values = { ...values, [b.key]: live };
      changed = true;
    }
  }
  return changed ? { ...s, values, data: { ...s.data, cost } } : s;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="label mb-2.5">{title}</h3>
      <div className="grid sm:grid-cols-2 gap-2.5">{children}</div>
    </section>
  );
}

function Field({ f, value, onChange }: { f: TemplateField; value: string; onChange: (v: string) => void }) {
  const wrap = f.full || f.type === 'multiline' ? 'sm:col-span-2' : '';
  return (
    <div className={wrap}>
      <label className="text-[11px] text-brand-muted block mb-0.5 flex items-center gap-1.5">
        {f.label}
        {f.bound && <span className="text-[9px] uppercase tracking-wide text-brand-greenDark/70 bg-brand-tint px-1 rounded">from client</span>}
      </label>
      {f.type === 'multiline' ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={f.placeholder} spellCheck className="input !py-1.5 text-sm resize-y" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} className="input !py-1.5 text-sm" />
      )}
      {f.help && <p className="text-[10px] text-brand-muted/80 mt-0.5">{f.help}</p>}
    </div>
  );
}

function MarketCards({ procure, loading }: { procure?: ProcureData; loading: boolean }) {
  if (!procure && loading) return <div className="text-sm text-brand-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Pulling live figures…</div>;
  if (!procure) return <p className="text-sm text-brand-muted">No market data yet — click Refresh.</p>;
  const cards = [
    { k: 'Front-year baseload power', c: procure.frontYearPower, unit: '£/MWh', pre: '£' },
    { k: 'Day-ahead power', c: procure.dayAheadPower, unit: '£/MWh', pre: '£' },
    { k: 'NBP gas (front-month)', c: procure.gas, unit: 'p/th', pre: '' },
    { k: 'Brent crude', c: procure.brent, unit: '$/bbl', pre: '$' },
  ];
  const sigTone = procure.signal === 'backwardation' ? 'bg-brand-tint text-brand-greenDark' : procure.signal === 'value' ? 'bg-amber-50 text-amber-700' : 'bg-brand-line/40 text-brand-muted';
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ k, c, unit, pre }) => (
          <div key={k} className="rounded-lg border border-brand-line p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-brand-muted leading-tight min-h-[24px]">{k}</div>
            <div className="font-mono font-semibold text-lg mt-1">{c.value === '—' ? '—' : `${pre}${c.value}`}<span className="text-[10px] text-brand-muted font-normal"> {unit}</span></div>
            {c.deltaText && (
              <div className={'text-[11px] font-mono inline-flex items-center gap-1 ' + (c.dir === 'down' ? 'text-brand-greenDark' : c.dir === 'up' ? 'text-amber-600' : 'text-brand-muted')}>
                {c.dir === 'down' ? <TrendingDown size={11} /> : c.dir === 'up' ? <TrendingUp size={11} /> : null}{c.deltaText}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2.5 text-[11px]">
        {procure.signal && <span className={'px-1.5 py-0.5 rounded font-medium capitalize ' + sigTone}>Forward curve: {procure.signal}</span>}
        <span className="text-brand-muted ml-auto">{procure.asOf}</span>
      </div>
    </div>
  );
}

function Inline({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[11px] text-brand-muted block mb-0.5">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={'input !py-1.5 text-sm ' + (mono ? 'font-mono' : '')} />
    </div>
  );
}
