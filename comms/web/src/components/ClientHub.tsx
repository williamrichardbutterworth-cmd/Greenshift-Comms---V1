import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, FileText, Mail, Paperclip, Plus, FilePlus2,
  StickyNote, Phone, ArrowRightCircle, CheckCircle2, Circle, Flag, RefreshCw, Trash2, ExternalLink,
  Wand2, Lightbulb, Copy, Check, UploadCloud, Pencil, FileSignature,
} from 'lucide-react';
import {
  api, type ClientProfile, type ClientStage, type ClientFile, type ActivityType,
  type SourceKind, type NextStep, type ReportInputs,
} from '../lib/api';
import { STAGES, MILESTONES, QUICK_LOG, milestoneLabel, relativeTime, stageIndex } from '../lib/crm';
import { deriveLoaFromClient, loaCompleteness, type CustomerVariables } from '../lib/loa';
import { ClientJourney } from './ClientJourney';

const FIELDS: { key: keyof ReportInputs; label: string }[] = [
  { key: 'companyName', label: 'Company' },
  { key: 'clientName', label: 'Contact' },
  { key: 'contact', label: 'Contact detail' },
  { key: 'currentSupplier', label: 'Supplier' },
  { key: 'contractEnd', label: 'Contract end' },
  { key: 'consumption', label: 'Consumption' },
  { key: 'sites', label: 'Sites / meters' },
];

const ACTIVITY_ICON: Record<ActivityType, typeof StickyNote> = {
  note: StickyNote, transcript: Phone, 'email-sent': Mail, 'email-received': Mail,
  document: FileText, file: Paperclip, stage: ArrowRightCircle, milestone: Flag, recommendation: Sparkles,
};
const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});

// The CRM client hub — everything about one client in one place: stage & tracker,
// an AI next-step, a client-specific "talk track", the dialogue timeline, intake
// (paste/upload) and a media bank of their documents.
export function ClientHub({
  clientId, onBack, onStartDocument, onDraftFromAngles, onOpenProject,
}: {
  clientId: string;
  onBack: () => void;
  onStartDocument: (client: ClientProfile, templateId?: string) => void;
  onDraftFromAngles: (client: ClientProfile, angles: string[]) => void;
  onOpenProject: (projectId: string) => void;
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
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const editSnapshot = useRef<ReportInputs | null>(null);

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

  // Client-specific "talk track": the conversational angles gathered across all
  // logged sources, newest first, de-duplicated.
  const angles = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const a of client?.activities ?? []) {
      for (const ang of (Array.isArray(a.meta?.angles) ? a.meta!.angles : [])) {
        if (typeof ang !== 'string') continue;
        const t = ang.trim(); const k = t.toLowerCase();
        if (t && !seen.has(k)) { seen.add(k); out.push(t); }
      }
      if (out.length >= 8) break;
    }
    return out;
  }, [client]);

  if (err && !client) return <div className="max-w-6xl mx-auto"><button className="btn-ghost mb-3" onClick={onBack}><ArrowLeft size={15} /> Back</button><p className="text-sm text-up" role="alert">{err}</p></div>;
  if (!client) return <div className="max-w-6xl mx-auto"><Loader2 className="animate-spin text-brand-green mt-10 mx-auto" size={22} /></div>;

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
    const updated = await logActivity({
      type: actType, title: a.summary || 'Update logged',
      detail: a.points.length ? a.points.map((p) => `• ${p}`).join('\n') : undefined,
      meta: a.angles?.length ? { angles: a.angles } : undefined,
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

  const setField = (k: keyof ReportInputs, v: string) => setClient((c) => (c ? { ...c, inputs: { ...c.inputs, [k]: v } } : c));
  const startEdit = () => { editSnapshot.current = { ...inputs }; setEditing(true); };
  const cancelEdit = () => { if (editSnapshot.current) setClient((c) => (c ? { ...c, inputs: editSnapshot.current! } : c)); setEditing(false); };
  const saveFields = async () => { await patch({ inputs }); setEditing(false); };

  const stageIdx = stageIndex(client.stage);
  const railStages = STAGES.filter((s) => s.key !== 'lost');

  return (
    <div className="max-w-6xl mx-auto space-y-4">
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
                <button className="btn-primary !py-1.5" onClick={() => onStartDocument(client)}><FilePlus2 size={15} /> New document</button>
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

        {/* Key fields */}
        <div className="px-5 py-4 border-t border-brand-line">
          <div className="flex items-center justify-between mb-2">
            <div className="label">Client details</div>
            {editing
              ? <span className="flex gap-2"><button className="btn-primary !py-1 text-xs" onClick={saveFields}>Save</button><button className="btn-ghost !py-1 text-xs" onClick={cancelEdit}>Cancel</button></span>
              : <button className="text-xs text-brand-greenDark hover:underline inline-flex items-center gap-1" onClick={startEdit}><Pencil size={12} /> Edit</button>}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="text-[11px] uppercase tracking-wide text-brand-muted">{f.label}</div>
                {editing ? (
                  <input className="input !py-1 text-sm mt-0.5" value={inputs[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
                ) : (
                  <div className="text-sm text-brand-ink mt-0.5 truncate" title={inputs[f.key] || ''}>{inputs[f.key] || <span className="text-brand-muted">—</span>}</div>
                )}
              </div>
            ))}
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
      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* ── Main column ── */}
        <div className="space-y-4 min-w-0">
          {/* Recommended next step */}
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
                  {next.templateId && (
                    <button className="btn-primary !py-1.5 text-sm shrink-0" onClick={() => onStartDocument(client, next.templateId)}>
                      <Wand2 size={14} /> Create this
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-brand-muted">
                  {next?.provider === 'none' ? 'Recommendations need automatic drafting configured.'
                    : next?.provider === 'error' ? 'Couldn’t fetch a recommendation — try Refresh.'
                    : 'No recommendation yet — log some activity below.'}
                </p>
              )}
          </section>

          {/* Talk track — client-specific angles */}
          {angles.length > 0 && (
            <section className="card p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="grid place-items-center h-6 w-6 rounded-lg bg-brand-green/10 text-brand-greenDark"><Lightbulb size={13} /></span>
                <h3 className="text-sm font-semibold">Talk track</h3>
                <span className="text-[11px] text-brand-muted hidden sm:inline">— angles for this client, gathered from your conversations</span>
                <button className="btn-ghost !py-1 !px-2 text-xs ml-auto shrink-0" onClick={() => onDraftFromAngles(client, angles)} title="Draft a follow-up email built on these angles">
                  <Sparkles size={13} /> Draft follow-up
                </button>
              </div>
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
            </section>
          )}

          {/* Log an update */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold">Log an update</h3>
              <span className="text-[11px] text-brand-muted">— paste a transcript, email or bill; it’s read, filed and used to update the client</span>
            </div>
            <div className="flex gap-2 mb-2">
              {(['transcript', 'email', 'bill'] as SourceKind[]).map((k) => (
                <button key={k} onClick={() => setIntakeKind(k)} aria-pressed={intakeKind === k} className={'text-xs px-2.5 py-1 rounded-lg border capitalize transition ' + (intakeKind === k ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{k}</button>
              ))}
            </div>
            <textarea className="input min-h-[84px] text-sm" placeholder="Paste the transcript / email / bill text here…" value={intakeText} onChange={(e) => setIntakeText(e.target.value)} />
            <div className="flex items-center gap-2 mt-2">
              <button className="btn-primary !py-1.5 text-sm" onClick={analyzePasted} disabled={analyzing || !intakeText.trim()}>
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {analyzing ? 'Reading…' : 'Read & log'}
              </button>
              <label className="btn-ghost !py-1.5 text-sm cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Upload document
                <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndAnalyze(f); e.target.value = ''; }} />
              </label>
            </div>

            {/* Manual quick-log — separated from the AI composer for a cleaner panel */}
            <div className="mt-3 pt-3 border-t border-brand-line flex items-center gap-1.5 flex-wrap">
              <span className="label mr-0.5">Quick log</span>
              {QUICK_LOG.map((q) => (
                <button key={q.label} onClick={() => quickLog(q)} className="text-[11px] px-2 py-1 rounded-md border border-brand-line text-brand-muted hover:text-brand-ink hover:bg-brand-tint transition">{q.label}</button>
              ))}
            </div>
          </section>

          {/* Timeline */}
          <section className="card p-4">
            <h3 className="text-sm font-semibold mb-3">Activity timeline</h3>
            <ol className="relative">
              {client.activities.map((a, i) => {
                const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                const isDoc = a.type === 'document' && !!a.meta?.projectId;
                const last = i === client.activities.length - 1;
                return (
                  <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {!last && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-brand-line" aria-hidden="true" />}
                    <span className="grid place-items-center h-[26px] w-[26px] rounded-full bg-brand-tint text-brand-greenDark shrink-0 ring-2 ring-white z-[1]"><Icon size={13} /></span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex items-baseline gap-2">
                        {isDoc ? (
                          <button type="button" className="text-sm text-left text-brand-greenDark hover:underline font-medium" onClick={() => onOpenProject(String(a.meta!.projectId))}>
                            {a.title}<ExternalLink size={11} className="inline ml-1 -mt-0.5" />
                          </button>
                        ) : (
                          <span className="text-sm text-brand-ink">{a.title}</span>
                        )}
                        <span className="text-[11px] text-brand-muted ml-auto shrink-0">{relativeTime(a.at)}</span>
                      </div>
                      {a.detail && <p className="text-xs text-brand-muted mt-1 whitespace-pre-line leading-relaxed">{a.detail}</p>}
                    </div>
                  </li>
                );
              })}
              {!client.activities.length && <li className="text-sm text-brand-muted">No activity yet — log an update above.</li>}
            </ol>
          </section>
        </div>

        {/* ── Side column ── */}
        <div className="space-y-4">
          {/* Letter of Authority status */}
          {(() => {
            const { known, total } = loaCompleteness(deriveLoaFromClient(inputs));
            const cv = (inputs as Record<string, unknown>).customerVariables as CustomerVariables | undefined;
            return (
              <section className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><FileSignature size={14} className="text-brand-greenDark" /> Letter of Authority</h3>
                  <span className={'text-[11px] font-medium ' + (known === total ? 'text-brand-green' : 'text-brand-muted')}>{known === total ? 'Ready' : `${known}/${total}`}</span>
                </div>
                <div className="h-1.5 rounded-full bg-brand-line overflow-hidden mb-2"><div className="h-full bg-brand-green rounded-full" style={{ width: `${(known / total) * 100}%` }} /></div>
                {cv?.fuel && <div className="text-xs text-brand-muted">Buys <span className="text-brand-ink capitalize">{cv.fuel === 'both' ? 'gas & electric' : cv.fuel}</span>{cv.services?.length ? ` · ${cv.services.slice(0, 3).join(', ')}` : ''}</div>}
                <p className="text-[11px] text-brand-muted mt-1.5">Complete &amp; export in the <span className="text-brand-greenDark">Letters of Authority</span> section.</p>
              </section>
            );
          })()}

          {/* Tracker */}
          <section className="card p-4">
            <h3 className="text-sm font-semibold mb-3">Tracker</h3>
            <div className="space-y-1">
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

          {/* Media bank */}
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
            <p className="text-[11px] text-brand-muted mt-1.5">Bills, LOAs &amp; notes are stored here, read for client intel, and can be inserted into any report you build for them.</p>
          </section>
        </div>
      </div>
      )}

      {err && <p className="text-sm text-up" role="alert">{err}</p>}
    </div>
  );
}
