import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, FileText, Paperclip, Plus, FilePlus2,
  Phone, CheckCircle2, Circle, RefreshCw, Trash2, ExternalLink,
  Wand2, Lightbulb, Copy, Check, UploadCloud, FileSignature, ClipboardList, ReceiptText, HeartHandshake,
} from 'lucide-react';
import {
  api, type ClientProfile, type ClientStage, type ClientFile, type ActivityType,
  type SourceKind, type NextStep, type ReportInputs,
} from '../lib/api';
import { STAGES, MILESTONES, QUICK_LOG, milestoneLabel, stageIndex, gatherAngles, gatherRapport } from '../lib/crm';
import { deriveLoaFromClient, loaCompleteness, type CustomerVariables } from '../lib/loa';
import { rfqCompleteness } from '../lib/rfq';
import { ClientJourney } from './ClientJourney';
import { ClientProfilePanel } from './ClientProfilePanel';

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});

// The CRM client hub — everything about one client in one place. The Overview is a
// deal cockpit: the next step, the talk-track call points and a live-call log up top;
// the full client record beside the LOA tracker; the milestone tracker + media below.
export function ClientHub({
  clientId, onBack, onStartDocument, onDraftFromAngles, onOpenProject, onOpenLoa, onOpenRfq, onOpenBills,
}: {
  clientId: string;
  onBack: () => void;
  onStartDocument: (client: ClientProfile, templateId?: string) => void;
  onDraftFromAngles: (client: ClientProfile, angles: string[]) => void;
  onOpenProject: (projectId: string) => void;
  onOpenLoa: () => void;
  onOpenRfq: () => void;
  onOpenBills: () => void;
}) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [next, setNext] = useState<NextStep | null>(null);
  const [nextLoading, setNextLoading] = useState(false);
  const [view, setView] = useState<'overview' | 'journey'>('overview');

  const [intakeText, setIntakeText] = useState('');
  const [intakeKind, setIntakeKind] = useState<SourceKind>('transcript');
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadFiles = useCallback(() => api.files.list({ clientProfileId: clientId }).then(setFiles).catch(() => {}), [clientId]);

  const recommend = useCallback((c: ClientProfile) => {
    setNextLoading(true);
    api.recommendNextStep({
      inputs: c.inputs,
      stage: c.stage,
      doneMilestones: Object.entries(c.tracker).filter(([, v]) => v).map(([k]) => milestoneLabel(k)),
      recentActivity: c.activities.slice(0, 8).map((a) => a.title),
    }).then(setNext).catch(() => setNext(null)).finally(() => setNextLoading(false));
  }, []);

  useEffect(() => {
    api.profiles.get(clientId).then((c) => { setClient(c); recommend(c); }).catch((e) => setErr(String((e as Error).message)));
    loadFiles();
  }, [clientId, loadFiles, recommend]);

  // Two client-specific talk tracks gathered across all logged sources, newest
  // first, de-duplicated: `angles` = the expertise/deal points; `rapport` = warm,
  // personal openers tailored to their business.
  const angles = useMemo(() => gatherAngles(client?.activities), [client]);
  const rapport = useMemo(() => gatherRapport(client?.activities), [client]);

  if (err && !client) return <div className="max-w-wide mx-auto"><button className="btn-ghost mb-3" onClick={onBack}><ArrowLeft size={15} /> Back</button><p className="text-sm text-up" role="alert">{err}</p></div>;
  if (!client) return <div className="max-w-wide mx-auto"><Loader2 className="animate-spin text-brand-green mt-10 mx-auto" size={22} /></div>;

  const inputs = client.inputs as ReportInputs;
  const docActivities = client.activities.filter((a) => a.type === 'document' && a.meta?.projectId);

  const patch = async (p: Parameters<typeof api.profiles.update>[1]) => {
    try { const updated = await api.profiles.update(clientId, p); setClient(updated); return updated; }
    catch (e) { setErr(String((e as Error).message)); return null; }
  };
  const logActivity = async (a: { type: ActivityType; title: string; detail?: string; meta?: Record<string, unknown> }) => {
    try { const updated = await api.profiles.addActivity(clientId, a); setClient(updated); return updated; }
    catch (e) { setErr(String((e as Error).message)); return null; }
  };

  const setStage = (stage: ClientStage) => patch({ stage });

  const toggleMilestone = async (key: string) => {
    const done = !!client.tracker[key];
    const tracker = { ...client.tracker, [key]: done ? null : new Date().toISOString() };
    const updated = await patch({ tracker });
    if (updated && !done) await logActivity({ type: 'milestone', title: `${milestoneLabel(key)} ✓`, meta: { milestone: key } });
  };

  const quickLog = async (q: (typeof QUICK_LOG)[number]) => {
    const note = window.prompt(`${q.label} — add a quick note (optional)`, '');
    if (note === null) return; // cancelled
    await logActivity({ type: q.type, title: note.trim() ? `${q.label}: ${note.trim()}` : q.label, meta: q.milestone ? { milestone: q.milestone } : undefined });
    if (q.milestone && !client.tracker[q.milestone]) await patch({ tracker: { ...client.tracker, [q.milestone]: new Date().toISOString() } });
  };

  // Apply an analysis result: merge new fields, capture angles, log a timeline entry, set milestones.
  const applyAnalysis = async (a: Awaited<ReturnType<typeof api.analyzeSource>>, sourceKind: SourceKind) => {
    const mergedInputs: ReportInputs = { ...inputs };
    for (const [k, v] of Object.entries(a.profile)) if (v && !String(mergedInputs[k as keyof ReportInputs] ?? '').trim()) (mergedInputs as Record<string, string>)[k] = v as string;
    const tracker = { ...client.tracker };
    for (const m of a.suggestedMilestones) if (!tracker[m]) tracker[m] = new Date().toISOString();
    await patch({ inputs: mergedInputs, tracker });
    const actType: ActivityType = sourceKind === 'email' ? 'email-received' : sourceKind === 'bill' ? 'file' : sourceKind === 'transcript' ? 'transcript' : 'note';
    const meta = { ...(a.angles?.length ? { angles: a.angles } : {}), ...(a.rapport?.length ? { rapport: a.rapport } : {}) };
    const updated = await logActivity({
      type: actType, title: a.summary || 'Update logged',
      detail: a.points.length ? a.points.map((p) => `• ${p}`).join('\n') : undefined,
      meta: Object.keys(meta).length ? meta : undefined,
    });
    if (updated) recommend(updated);
  };

  const analyzePasted = async () => {
    if (!intakeText.trim()) return;
    setAnalyzing(true); setErr(null);
    try {
      const a = await api.analyzeSource(intakeText, intakeKind, inputs);
      if (a.error && a.provider !== 'claude' && a.provider !== 'openai') setErr(`Analysis unavailable: ${a.error}`);
      else { await applyAnalysis(a, intakeKind); setIntakeText(''); }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setAnalyzing(false); }
  };

  const uploadAndAnalyze = async (file: File) => {
    setUploading(true); setErr(null);
    try {
      const base64 = await fileToBase64(file);
      const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, clientProfileId: clientId });
      setFiles((f) => [saved, ...f]);
      await logActivity({ type: 'file', title: `Uploaded ${file.name}`, meta: { fileId: saved.id } });
      if (saved.extractedText.trim()) {
        const a = await api.analyzeSource(saved.extractedText, 'auto', inputs);
        if (a.error && a.provider !== 'claude' && a.provider !== 'openai') setErr(`File uploaded, but analysis was unavailable: ${a.error}`);
        else await applyAnalysis(a, (['transcript', 'email', 'bill'] as const).includes(a.kind as 'transcript' | 'email' | 'bill') ? (a.kind as SourceKind) : 'bill');
      }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setUploading(false); }
  };

  const removeFile = async (id: string) => { try { await api.files.remove(id); setFiles((f) => f.filter((x) => x.id !== id)); } catch (e) { setErr(String((e as Error).message)); } };

  const copyAngle = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied((c) => (c === text ? null : c)), 1400); }
    catch { setErr('Couldn’t copy — select the text and copy manually.'); }
  };

  const stageIdx = stageIndex(client.stage);
  const railStages = STAGES.filter((s) => s.key !== 'lost');

  return (
    <div className="max-w-wide mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button className="btn-ghost !py-1.5 !px-2" onClick={onBack}><ArrowLeft size={15} /> All clients</button>
        <div className="inline-flex rounded-lg border border-brand-line bg-white p-0.5 text-sm">
          {(['overview', 'journey'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={'px-3 py-1 rounded-md transition ' + (view === v ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted hover:text-brand-ink')}>
              {v === 'journey' ? 'Journey' : 'Overview'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Header ── */}
      <section className="card overflow-hidden">
        <div className="p-5 bg-gradient-to-br from-brand-tint to-white">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span className="grid place-items-center h-12 w-12 rounded-xl bg-brand-green/15 text-brand-greenDark shrink-0"><Building2 size={22} /></span>
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold leading-tight truncate">{client.name}</h2>
                <div className="flex items-center gap-2 mt-1.5 text-sm text-brand-muted">
                  {inputs.currentSupplier && <span>{inputs.currentSupplier}</span>}
                  {inputs.contractEnd && <><span className="text-brand-line">·</span><span>ends {inputs.contractEnd}</span></>}
                  {inputs.consumption && <><span className="text-brand-line">·</span><span>{inputs.consumption}</span></>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select className="input !py-1.5 !w-auto text-sm" value={client.stage} onChange={(e) => setStage(e.target.value as ClientStage)} title="Pipeline stage">
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              {next?.templateId ? (
                <button className="btn-primary !py-1.5" onClick={() => onStartDocument(client, next.templateId)} title={next.action || 'Create the recommended document'}>
                  <Wand2 size={15} /> Do next step
                </button>
              ) : (
                <button className="btn-primary !py-1.5" onClick={() => onStartDocument(client)}><FilePlus2 size={15} /> New report</button>
              )}
            </div>
          </div>

          {/* Stage rail — a segmented progress bar */}
          <div className="flex gap-1.5 mt-5" role="group" aria-label="Pipeline progress">
            {railStages.map((s, i) => {
              const current = i === stageIdx && client.stage !== 'lost';
              return (
                <div key={s.key} className="flex-1 min-w-0" aria-current={current ? 'step' : undefined}>
                  <div className={'h-1.5 rounded-full ' + (i <= stageIdx && client.stage !== 'lost' ? 'bg-brand-green' : 'bg-brand-line')} />
                  <div className={'text-[10px] mt-1 truncate flex items-center gap-1 ' + (current ? 'text-brand-greenDark font-semibold' : i < stageIdx ? 'text-brand-ink' : 'text-brand-muted')} title={s.label}>
                    {current && <span className="h-1.5 w-1.5 rounded-full bg-brand-green shrink-0" aria-hidden="true" />}{s.label}
                  </div>
                </div>
              );
            })}
            {client.stage === 'lost' && <div className="self-start text-[11px] px-2 py-0.5 rounded-full bg-up/10 text-up">Lost</div>}
          </div>
        </div>
      </section>

      {view === 'journey' ? (
        <ClientJourney
          client={client}
          next={next}
          nextLoading={nextLoading}
          angles={angles}
          onStartDocument={onStartDocument}
          onDraftFromAngles={onDraftFromAngles}
          onOpenProject={onOpenProject}
        />
      ) : (
      <div className="space-y-4">
        {/* ── Deal cockpit: move this deal forward ── */}
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
          {/* Left: next step + talk track call-points */}
          <div className="space-y-4 min-w-0">
            <section className="card p-4 bg-gradient-to-br from-brand-tint to-white">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="grid place-items-center h-6 w-6 rounded-lg bg-brand-green/15 text-brand-greenDark"><Sparkles size={13} /></span>
                <h3 className="text-sm font-semibold">Recommended next step</h3>
                <button className="ml-auto text-brand-muted hover:text-brand-ink" onClick={() => recommend(client)} title="Refresh recommendation" disabled={nextLoading}>
                  <RefreshCw size={13} className={nextLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {nextLoading ? <p className="text-sm text-brand-muted">Thinking…</p>
                : next?.action ? (
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{next.action}</p>
                      {next.rationale && <p className="text-[13px] text-brand-muted mt-0.5 leading-snug">{next.rationale}</p>}
                    </div>
                    <button className="btn-primary !py-1.5 text-sm shrink-0" onClick={() => onStartDocument(client, next.templateId || undefined)}>
                      <Wand2 size={14} /> {next.templateId ? 'Create this' : 'New report'}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-brand-muted">
                    {next?.provider === 'none' ? 'Recommendations need automatic drafting configured.'
                      : next?.provider === 'error' ? 'Couldn’t fetch a recommendation — try Refresh.'
                      : 'No recommendation yet — log a call below.'}
                  </p>
                )}
            </section>

            <section className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="grid place-items-center h-6 w-6 rounded-lg bg-brand-green/10 text-brand-greenDark"><Lightbulb size={13} /></span>
                <h3 className="text-sm font-semibold">Talk track</h3>
                <span className="text-[11px] text-brand-muted hidden sm:inline">— how to lead the next call</span>
                {angles.length > 0 && (
                  <button className="btn-ghost !py-1 !px-2 text-xs ml-auto shrink-0" onClick={() => onDraftFromAngles(client, angles)} title="Draft a follow-up email built on these angles">
                    <Sparkles size={13} /> Draft follow-up
                  </button>
                )}
              </div>

              {/* Expertise track — the structured, deal-advancing points */}
              <div className="text-[11px] uppercase tracking-wide text-brand-muted mb-1.5 flex items-center gap-1.5"><Lightbulb size={12} className="text-brand-greenDark" /> Expertise — points to land</div>
              {angles.length > 0 ? (
                <ul className="space-y-1.5">
                  {angles.map((ang) => (
                    <li key={ang} className="group flex items-start gap-2 rounded-lg px-2.5 py-2 bg-brand-tint/60 hover:bg-brand-tint transition">
                      <span className="text-brand-green mt-0.5 shrink-0">›</span>
                      <span className="text-[13px] leading-snug flex-1">{ang}</span>
                      <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-brand-greenDark shrink-0 transition" onClick={() => copyAngle(ang)} title="Copy">
                        {copied === ang ? <Check size={13} className="text-brand-green" /> : <Copy size={13} />}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-brand-muted">No call points yet — log a call or paste a transcript and we’ll gather talking points.</p>
              )}

              {/* Rapport track — warm, personal openers tailored to their business */}
              <div className="text-[11px] uppercase tracking-wide text-brand-muted mt-4 mb-1.5 flex items-center gap-1.5"><HeartHandshake size={12} className="text-brand-greenDark" /> Rapport — questions that set us apart</div>
              {rapport.length > 0 ? (
                <ul className="space-y-1.5">
                  {rapport.map((q) => (
                    <li key={q} className="group flex items-start gap-2 rounded-lg px-2.5 py-2 bg-brand-surface border border-brand-line/70 hover:bg-brand-tint/50 transition">
                      <HeartHandshake size={13} className="text-brand-greenDark mt-0.5 shrink-0" />
                      <span className="text-[13px] leading-snug flex-1">{q}</span>
                      <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-brand-greenDark shrink-0 transition" onClick={() => copyAngle(q)} title="Copy">
                        {copied === q ? <Check size={13} className="text-brand-green" /> : <Copy size={13} />}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-brand-muted">Warm, personal openers tailored to their business will appear here as we learn about them — drawn from their website and your calls.</p>
              )}
            </section>
          </div>

          {/* Right: live-call log / capture */}
          <section className="card p-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
            <div className="flex items-center gap-2 mb-1">
              <span className="grid place-items-center h-6 w-6 rounded-lg bg-brand-green/15 text-brand-greenDark"><Phone size={13} /></span>
              <h3 className="text-sm font-semibold">Log this call</h3>
            </div>
            <p className="text-[11px] text-brand-muted mb-2.5">Paste a transcript, email or bill — it’s read, filed, and the client record + tracker update automatically.</p>
            <div className="flex gap-1.5 mb-2">
              {(['transcript', 'email', 'bill'] as SourceKind[]).map((k) => (
                <button key={k} onClick={() => setIntakeKind(k)} aria-pressed={intakeKind === k} className={'text-xs px-2.5 py-1 rounded-lg border capitalize transition ' + (intakeKind === k ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{k}</button>
              ))}
            </div>
            <textarea className="input min-h-[150px] text-sm" placeholder="Paste the transcript / email / bill text here, or type live notes during the call…" value={intakeText} onChange={(e) => setIntakeText(e.target.value)} />
            <div className="flex items-center gap-2 mt-2">
              <button className="btn-primary !py-1.5 text-sm flex-1 justify-center" onClick={analyzePasted} disabled={analyzing || !intakeText.trim()}>
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {analyzing ? 'Reading…' : 'Read & log'}
              </button>
              <label className="btn-ghost !py-1.5 text-sm cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Upload
                <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndAnalyze(f); e.target.value = ''; }} />
              </label>
            </div>
            <div className="mt-3 pt-3 border-t border-brand-line flex items-center gap-1.5 flex-wrap">
              <span className="label mr-0.5">Quick log</span>
              {QUICK_LOG.map((q) => (
                <button key={q.label} onClick={() => quickLog(q)} className="text-[11px] px-2 py-1 rounded-md border border-brand-line text-brand-muted hover:text-brand-ink hover:bg-brand-tint transition">{q.label}</button>
              ))}
            </div>
          </section>
        </div>

        {/* ── Client record + Letter of Authority ── */}
        <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
          <ClientProfilePanel inputs={inputs} onSave={(nextInputs) => patch({ inputs: nextInputs })} />

          {(() => {
            const loa = loaCompleteness(deriveLoaFromClient(inputs));
            const rfq = rfqCompleteness(inputs);
            const billsAnalysed = client.activities.filter((a) => a.type === 'file' && /bill analysed/i.test(a.title)).length;
            const billsDone = !!client.tracker.billReceived || billsAnalysed > 0;
            const cv = (inputs as Record<string, unknown>).customerVariables as CustomerVariables | undefined;
            const Bar = ({ pct }: { pct: number }) => (
              <div className="h-1.5 rounded-full bg-brand-line overflow-hidden"><div className="h-full bg-brand-green rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
            );
            return (
              <section className="card p-4">
                <h3 className="text-sm font-semibold mb-3">Key steps</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-[13px] mb-1">
                      <span className="flex items-center gap-1.5 font-medium"><ReceiptText size={13} className="text-brand-greenDark" /> Bills analysed</span>
                      <span className={billsDone ? 'text-brand-green font-medium' : 'text-brand-muted'}>{billsAnalysed > 0 ? billsAnalysed : billsDone ? 'Done' : '—'}</span>
                    </div>
                    <Bar pct={billsDone ? 100 : 0} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[13px] mb-1">
                      <span className="flex items-center gap-1.5 font-medium"><FileSignature size={13} className="text-brand-greenDark" /> Letter of Authority</span>
                      <span className={loa.known === loa.total ? 'text-brand-green font-medium' : 'text-brand-muted'}>{loa.known === loa.total ? 'Ready' : `${loa.known}/${loa.total}`}</span>
                    </div>
                    <Bar pct={(loa.known / loa.total) * 100} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[13px] mb-1">
                      <span className="flex items-center gap-1.5 font-medium"><ClipboardList size={13} className="text-brand-greenDark" /> RFQ qualification</span>
                      <span className={rfq.known === rfq.total ? 'text-brand-green font-medium' : 'text-brand-muted'}>{rfq.known === rfq.total ? 'Ready' : `${rfq.known}/${rfq.total}`}</span>
                    </div>
                    <Bar pct={(rfq.known / rfq.total) * 100} />
                  </div>
                </div>
                {cv?.fuel && <div className="text-xs text-brand-muted mt-3">Buys <span className="text-brand-ink capitalize">{cv.fuel === 'both' ? 'gas & electric' : cv.fuel}</span></div>}
                <div className="mt-3 pt-3 border-t border-brand-line space-y-2">
                  <button className="btn-ghost w-full justify-center !py-1.5 text-sm" onClick={onOpenBills}><ReceiptText size={14} /> Open Bill Analysis</button>
                  <button className="btn-primary w-full justify-center !py-1.5 text-sm" onClick={onOpenLoa}><FileSignature size={14} /> Open LOA editor</button>
                  <button className="btn-ghost w-full justify-center !py-1.5 text-sm" onClick={onOpenRfq}><ClipboardList size={14} /> Open RFQ form</button>
                </div>
              </section>
            );
          })()}
        </div>

        {/* ── Tracker + Documents & media (bottom) ── */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <section className="card p-4">
            <h3 className="text-sm font-semibold mb-3">Tracker</h3>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {MILESTONES.map((m) => {
                const done = !!client.tracker[m.key];
                return (
                  <button key={m.key} onClick={() => toggleMilestone(m.key)} className="flex items-center gap-2.5 w-full text-left text-sm group rounded-md px-1.5 py-1 hover:bg-brand-tint/60 transition">
                    {done ? <CheckCircle2 size={17} className="text-brand-green shrink-0" /> : <Circle size={17} className="text-brand-line group-hover:text-brand-muted shrink-0" />}
                    <span className={done ? 'text-brand-ink' : 'text-brand-muted'}>{m.label}</span>
                    {done && client.tracker[m.key] && <span className="text-[10px] text-brand-muted ml-auto">{new Date(client.tracker[m.key] as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Documents &amp; media</h3>
              <button className="text-xs text-brand-greenDark hover:underline inline-flex items-center gap-1" onClick={() => onStartDocument(client)}><Plus size={12} /> New</button>
            </div>

            {docActivities.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">Generated reports</div>
                <div className="space-y-1">
                  {docActivities.map((a) => (
                    <button key={a.id} className="flex items-center gap-2 w-full text-left text-sm hover:bg-brand-tint rounded-md px-1.5 py-1 transition" onClick={() => onOpenProject(String(a.meta!.projectId))}>
                      <span className="grid place-items-center h-6 w-6 rounded bg-brand-tint text-brand-greenDark shrink-0"><FileText size={12} /></span>
                      <span className="flex-1 truncate">{a.title.replace(/^Created /, '')}</span>
                      <ExternalLink size={12} className="text-brand-muted shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">Client files</div>
            <div className="space-y-1 mb-2">
              {files.map((f) => (
                <div key={f.id} className="group flex items-center gap-2 text-sm rounded-md px-1.5 py-1 hover:bg-brand-tint/60 transition">
                  <span className="grid place-items-center h-6 w-6 rounded bg-brand-line/50 text-brand-muted shrink-0"><Paperclip size={12} /></span>
                  <a href={api.files.downloadUrl(f.id)} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-brand-green" title={f.name}>{f.name}</a>
                  {f.extractedText && <span className="text-[9px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0" title="Text read for context & reports">read</span>}
                  <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-up shrink-0 transition" onClick={() => removeFile(f.id)} title="Remove"><Trash2 size={12} /></button>
                </div>
              ))}
              {!files.length && <p className="text-xs text-brand-muted">No files yet.</p>}
            </div>

            <label className="btn-ghost w-full cursor-pointer justify-center !py-1.5 text-sm">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} Upload a document
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndAnalyze(f); e.target.value = ''; }} />
            </label>
          </section>
        </div>
      </div>
      )}

      {err && <p className="text-sm text-up" role="alert">{err}</p>}
    </div>
  );
}
