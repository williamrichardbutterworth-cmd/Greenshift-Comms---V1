import { useEffect, useState } from 'react';
import { X, Building2, Sparkles, Loader2, Paperclip, CheckCircle2, FilePlus2, Globe } from 'lucide-react';
import {
  api, type ReportInputs, type ClientProfile, type SourceKind, type SourceAnalysis, type ActivityType,
} from '../lib/api';
import { milestoneLabel } from '../lib/crm';
import { LOA_FIELDS, type LoaData, type CustomerVariables, type Fuel } from '../lib/loa';

const FIELD_DEFS: Record<string, { label: string; placeholder: string }> = {
  companyName: { label: 'Company', placeholder: 'Acme Manufacturing Ltd' },
  clientName: { label: 'Contact name', placeholder: 'Jane Smith' },
  contact: { label: 'Contact detail', placeholder: 'jane@acme.co.uk' },
  currentSupplier: { label: 'Current supplier', placeholder: 'British Gas' },
  contractEnd: { label: 'Contract end', placeholder: 'Sep 2026' },
  consumption: { label: 'Annual consumption', placeholder: '450,000 kWh' },
  sites: { label: 'Sites / meters', placeholder: '3 sites · 4 MPANs' },
};
// Grouped so the form reads as a structured record (matches the studio tray).
const FIELD_GROUPS: { label: string; keys: (keyof ReportInputs)[] }[] = [
  { label: 'Identity', keys: ['companyName', 'clientName', 'contact'] },
  { label: 'Contract', keys: ['currentSupplier', 'contractEnd', 'sites'] },
  { label: 'Consumption', keys: ['consumption'] },
];

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});
const kindToActivity = (k: SourceKind): ActivityType => (k === 'email' ? 'email-received' : k === 'bill' ? 'file' : k === 'transcript' ? 'transcript' : 'note');

// Smooth client creation: name the client, optionally draft it from a pasted /
// uploaded bill, transcript or email (we read it and fill the details), then
// open the hub.
export function ClientCreate({ onCreated, onCancel }: { onCreated: (c: ClientProfile) => void; onCancel: () => void }) {
  const [inputs, setInputs] = useState<ReportInputs>({});
  const [kind, setKind] = useState<SourceKind>('transcript');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SourceAnalysis | null>(null);
  const [website, setWebsite] = useState('');
  const [scraping, setScraping] = useState(false);
  // LOA fields + variables + summary harvested from the website (carried onto the client).
  const [scraped, setScraped] = useState<{ summary: string; loa: LoaData; fuel: Fuel; services: string[] } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof ReportInputs, v: string) => setInputs((s) => ({ ...s, [k]: v }));

  // Unsaved work guard — a stray backdrop click / Esc shouldn't bin a pasted
  // transcript, an analysis result or typed-in details without warning.
  const isDirty = () => !!(text.trim() || analysis || file || website.trim() || scraped || Object.values(inputs).some((v) => (v ?? '').trim()));
  const requestClose = () => { if (busy) return; if (!isDirty() || window.confirm('Discard this client? Your entered details will be lost.')) onCancel(); };

  // Esc closes (guarded), matching the other modals in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, analysis, file, inputs, busy]);

  // Scrape the company website → company summary + harvest LOA details, then
  // prefill the visible fields. The full LOA fields/variables ride onto the client.
  const FIELD_TO_INPUT: Record<string, keyof ReportInputs> = { customerName: 'companyName', authorisedRep: 'clientName' };
  const scrapeWebsite = async () => {
    if (!website.trim()) return;
    setScraping(true); setErr(null);
    try {
      const res = await api.loa.scrape(website.trim(), undefined);
      if (res.error && res.provider !== 'claude' && res.provider !== 'openai') { setErr(res.error); return; }
      // Prefill the visible client fields.
      setInputs((s) => {
        const next = { ...s } as Record<string, string>;
        for (const [fk, ik] of Object.entries(FIELD_TO_INPUT)) { const v = res.fields[fk]; if (v && !(next[ik] ?? '').trim()) next[ik] = v; }
        const contact = res.fields.email || res.fields.telephone;
        if (contact && !(next.contact ?? '').trim()) next.contact = contact;
        return next as ReportInputs;
      });
      const loa: LoaData = {};
      for (const f of LOA_FIELDS) { const v = res.fields[f.key]; if (v && v.trim()) loa[f.key] = { value: v.trim(), source: 'website' }; }
      setScraped({ summary: res.companySummary, loa, fuel: res.fuel, services: res.services });
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setScraping(false); }
  };

  // Analyse pasted text → prefill the editable fields + show what was found.
  const analysePasted = async () => {
    if (!text.trim()) return;
    setAnalyzing(true); setErr(null);
    try {
      const a = await api.analyzeSource(text, kind, inputs);
      if (a.error && a.provider !== 'claude' && a.provider !== 'openai') { setErr(`Analysis unavailable: ${a.error}`); return; }
      setAnalysis(a);
      setInputs((s) => { const next = { ...s }; for (const [k, v] of Object.entries(a.profile)) if (v) (next as Record<string, string>)[k] = v as string; return next; });
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setAnalyzing(false); }
  };

  const applyAnalysisToClient = async (clientId: string, a: SourceAnalysis, sourceKind: SourceKind, startInputs: ReportInputs) => {
    const tracker: Record<string, string> = {};
    for (const m of a.suggestedMilestones) tracker[m] = new Date().toISOString();
    const mergedInputs: ReportInputs = { ...startInputs };
    for (const [k, v] of Object.entries(a.profile)) if (v && !String(mergedInputs[k as keyof ReportInputs] ?? '').trim()) (mergedInputs as Record<string, string>)[k] = v as string;
    const cur = await api.profiles.update(clientId, { inputs: mergedInputs, ...(Object.keys(tracker).length ? { tracker } : {}) }).catch(() => null);
    const updated = await api.profiles.addActivity(clientId, {
      type: kindToActivity(sourceKind), title: a.summary || 'Intake logged',
      detail: a.points.length ? a.points.map((p) => `• ${p}`).join('\n') : undefined,
      meta: a.angles?.length ? { angles: a.angles } : undefined,
    }).catch(() => null);
    return updated ?? cur;
  };

  const create = async () => {
    const companyName = (inputs.companyName ?? '').trim();
    if (!companyName) { setErr('Add a company name (or analyse a document first).'); return; }
    setBusy(true); setErr(null);
    try {
      setStage('Creating client…');
      // Carry the website summary + harvested LOA fields + fuel/services onto the client.
      const extra: Record<string, unknown> = {};
      if (website.trim()) extra.website = website.trim();
      if (scraped?.summary) extra.companySummary = scraped.summary;
      if (scraped && Object.keys(scraped.loa).length) extra.loa = scraped.loa;
      if (scraped && (scraped.fuel || scraped.services.length)) extra.customerVariables = { fuel: scraped.fuel, services: scraped.services } as CustomerVariables;
      let client = await api.profiles.create({ name: companyName, inputs: { ...inputs, companyName, ...extra } as ReportInputs });
      // Past this point the client EXISTS on the server. Every enrichment step is
      // best-effort — a failure here must never strand the new client or send the
      // user back to a form that would create a duplicate on retry.
      try {
        if (analysis) { setStage('Filing the intake…'); client = (await applyAnalysisToClient(client.id, analysis, kind, client.inputs as ReportInputs)) ?? client; }
        if (file) {
          setStage('Reading your document…');
          const base64 = await fileToBase64(file);
          const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, clientProfileId: client.id }).catch(() => null);
          if (saved) {
            await api.profiles.addActivity(client.id, { type: 'file', title: `Uploaded ${file.name}`, meta: { fileId: saved.id } }).catch(() => {});
            if (saved.extractedText.trim()) {
              setStage('Reading your document…');
              const a = await api.analyzeSource(saved.extractedText, 'auto', client.inputs as ReportInputs);
              if (!a.error || a.provider === 'claude' || a.provider === 'openai') client = (await applyAnalysisToClient(client.id, a, 'bill', client.inputs as ReportInputs)) ?? client;
            }
          }
        }
      } catch { /* enrichment is best-effort; the client is already created */ }
      onCreated(client);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false); setStage(null);
    }
  };

  const foundFields = analysis ? Object.entries(analysis.profile).filter(([, v]) => v).map(([k]) => k) : [];
  const canCreate = !busy && !!(inputs.companyName ?? '').trim();

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={requestClose}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-auto p-5" role="dialog" aria-modal="true" aria-label="New client" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 size={18} className="text-brand-greenDark" /> New client</h2>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel} title="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-brand-muted mb-4">Draft a client from a bill, call transcript or email — we’ll read it and fill in the details. You can edit anything before saving.</p>

        {/* Company website → scrape */}
        <div className="card p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={15} className="text-brand-greenDark" />
            <span className="text-sm font-medium">Company website</span>
            <span className="text-[11px] text-brand-muted hidden sm:inline">— we’ll summarise it and harvest LOA details</span>
          </div>
          <div className="flex gap-1.5">
            <input className="input !py-1.5 text-sm flex-1" placeholder="acme-manufacturing.co.uk" value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scrapeWebsite(); }} />
            <button className="btn-ghost !py-1.5 text-sm" onClick={scrapeWebsite} disabled={scraping || !website.trim()}>
              {scraping ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {scraping ? 'Reading…' : 'Fetch'}
            </button>
          </div>
          {scraped && (scraped.summary || Object.keys(scraped.loa).length > 0) && (
            <div className="mt-2 text-xs">
              {scraped.summary && <p className="text-brand-ink leading-snug">{scraped.summary}</p>}
              {Object.keys(scraped.loa).length > 0 && <p className="text-brand-greenDark mt-1 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Harvested {Object.keys(scraped.loa).length} LOA detail(s) — fill the rest in the Letters of Authority section.</p>}
            </div>
          )}
        </div>

        {/* Draft from a document */}
        <div className="card p-3 bg-gradient-to-br from-brand-tint to-white mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={15} className="text-brand-green" />
            <span className="text-sm font-medium">Draft from a document</span>
            <div className="flex gap-1 ml-auto">
              {(['transcript', 'email', 'bill'] as SourceKind[]).map((k) => (
                <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={'text-xs px-2 py-0.5 rounded-lg border capitalize transition ' + (kind === k ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{k}</button>
              ))}
            </div>
          </div>
          <textarea autoFocus className="input min-h-[80px] text-sm bg-white" placeholder="Paste a transcript / email / bill here, then Analyse — or upload a document below…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button className="btn-primary !py-1.5 text-sm" onClick={analysePasted} disabled={analyzing || !text.trim()}>
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {analyzing ? 'Reading…' : 'Analyse'}
            </button>
            <label className="btn-ghost !py-1.5 text-sm cursor-pointer">
              <Paperclip size={14} /> {file ? file.name.slice(0, 28) : 'Upload document'}
              <input type="file" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            {file && <span className="text-[11px] text-brand-muted">read &amp; attached on save</span>}
            {analysis && foundFields.length > 0 && (
              <span className="text-[11px] text-brand-greenDark inline-flex items-center gap-1 ml-auto"><CheckCircle2 size={13} /> Found {foundFields.length} field(s){analysis.suggestedMilestones.length ? ` · ${analysis.suggestedMilestones.map(milestoneLabel).join(', ')}` : ''}</span>
            )}
          </div>
        </div>

        {/* Editable details — grouped */}
        <div className="space-y-3">
          {FIELD_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="label mb-1.5">{g.label}</div>
              <div className="grid sm:grid-cols-2 gap-3">
                {g.keys.map((key) => (
                  <div key={key} className={key === 'companyName' ? 'sm:col-span-2' : ''}>
                    <label className="text-[11px] text-brand-muted block mb-0.5">{FIELD_DEFS[key].label}{key === 'companyName' && <span className="text-up" aria-hidden="true"> *</span>}</label>
                    <input className="input" placeholder={FIELD_DEFS[key].placeholder} value={inputs[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className="label mb-1.5">Notes</div>
            <textarea className="input min-h-[56px]" placeholder="Budget, risk appetite, renewal goals…" value={inputs.agentNotes ?? ''} onChange={(e) => set('agentNotes', e.target.value)} />
          </div>
        </div>

        {err && <p className="text-sm text-up mt-3" role="alert">{err}</p>}

        <div className="flex items-center justify-end gap-2 mt-5">
          {!canCreate && !busy && <span className="text-[11px] text-brand-muted mr-auto">Add a company name to create the client.</span>}
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={!canCreate} title={canCreate ? undefined : 'Add a company name first'}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />} {busy ? (stage ?? 'Creating…') : 'Create client'}
          </button>
        </div>
      </div>
    </div>
  );
}
