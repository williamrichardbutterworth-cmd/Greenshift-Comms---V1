import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, FileText, Mail, Paperclip, Plus, FilePlus2,
  StickyNote, Phone, ArrowRightCircle, CheckCircle2, Circle, Flag, RefreshCw, Trash2, ExternalLink, Wand2,
} from 'lucide-react';
import {
  api, type ClientProfile, type ClientStage, type ClientFile, type ClientActivity, type ActivityType,
  type SourceKind, type NextStep, type ReportInputs,
} from '../lib/api';
import { STAGES, MILESTONES, QUICK_LOG, milestoneLabel, relativeTime, stageIndex } from '../lib/crm';

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

// The CRM client hub — everything about one client in one place: stage, tracker,
// AI next-step, the full dialogue timeline, intake (paste/upload), and documents.
export function ClientHub({
  clientId, onBack, onStartDocument, onOpenProject,
}: {
  clientId: string;
  onBack: () => void;
  onStartDocument: (client: ClientProfile, templateId?: string) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [next, setNext] = useState<NextStep | null>(null);
  const [nextLoading, setNextLoading] = useState(false);

  const [intakeText, setIntakeText] = useState('');
  const [intakeKind, setIntakeKind] = useState<SourceKind>('transcript');
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
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

  if (err) return <div className="max-w-5xl mx-auto"><button className="btn-ghost mb-3" onClick={onBack}><ArrowLeft size={15} /> Back</button><p className="text-sm text-up">{err}</p></div>;
  if (!client) return <div className="max-w-5xl mx-auto"><Loader2 className="animate-spin text-brand-green mt-10 mx-auto" size={22} /></div>;

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

  // Apply an analysis result: merge new fields, log a timeline entry, set milestones.
  const applyAnalysis = async (a: Awaited<ReturnType<typeof api.analyzeSource>>, sourceKind: SourceKind) => {
    const mergedInputs: ReportInputs = { ...inputs };
    for (const [k, v] of Object.entries(a.profile)) if (v && !String(mergedInputs[k as keyof ReportInputs] ?? '').trim()) (mergedInputs as Record<string, string>)[k] = v as string;
    const tracker = { ...client.tracker };
    for (const m of a.suggestedMilestones) if (!tracker[m]) tracker[m] = new Date().toISOString();
    await patch({ inputs: mergedInputs, tracker });
    const actType: ActivityType = sourceKind === 'email' ? 'email-received' : sourceKind === 'bill' ? 'file' : sourceKind === 'transcript' ? 'transcript' : 'note';
    const updated = await logActivity({ type: actType, title: a.summary || 'Update logged', detail: a.points.length ? a.points.map((p) => `• ${p}`).join('\n') : undefined });
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
        else await applyAnalysis(a, 'bill');
      }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setUploading(false); }
  };

  const removeFile = async (id: string) => { try { await api.files.remove(id); setFiles((f) => f.filter((x) => x.id !== id)); } catch (e) { setErr(String((e as Error).message)); } };

  const setField = (k: keyof ReportInputs, v: string) => setClient((c) => (c ? { ...c, inputs: { ...c.inputs, [k]: v } } : c));
  const startEdit = () => { editSnapshot.current = { ...inputs }; setEditing(true); };
  const cancelEdit = () => { if (editSnapshot.current) setClient((c) => (c ? { ...c, inputs: editSnapshot.current! } : c)); setEditing(false); };
  const saveFields = async () => { await patch({ inputs }); setEditing(false); };

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <button className="btn-ghost !py-1.5 !px-2" onClick={onBack}><ArrowLeft size={15} /> All clients</button>

      {/* Header */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="grid place-items-center h-11 w-11 rounded-xl bg-brand-green/10 text-brand-greenDark shrink-0"><Building2 size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold truncate">{client.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <label className="label">Stage</label>
                <select className="input !py-1 !w-auto text-sm" value={client.stage} onChange={(e) => setStage(e.target.value as ClientStage)}>
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {next?.templateId ? (
              <>
                <button className="btn-ghost !py-1.5" onClick={() => onStartDocument(client)}><FilePlus2 size={15} /> New document</button>
                <button className="btn-primary !py-1.5" onClick={() => onStartDocument(client, next.templateId)} title={next.action || 'Create the recommended document'}>
                  <Wand2 size={15} /> Do next step
                </button>
              </>
            ) : (
              <button className="btn-primary !py-1.5" onClick={() => onStartDocument(client)}><FilePlus2 size={15} /> New document</button>
            )}
          </div>
        </div>

        {/* Stage progress strip */}
        <div className="flex items-center gap-1 mt-4 overflow-x-auto pb-1">
          {STAGES.filter((s) => s.key !== 'lost').map((s, i) => {
            const idx = stageIndex(client.stage);
            const active = i <= idx && client.stage !== 'lost';
            return (
              <div key={s.key} className="flex items-center gap-1 shrink-0">
                <span className={'text-[11px] px-2 py-0.5 rounded-full ' + (active ? 'bg-brand-green text-white' : 'bg-brand-line/60 text-brand-muted')}>{s.label}</span>
                {i < STAGES.length - 2 && <span className="text-brand-line">›</span>}
              </div>
            );
          })}
          {client.stage === 'lost' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-up/10 text-up ml-1">Lost</span>}
        </div>

        {/* Key fields */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 mt-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <div className="label">{f.label}</div>
              {editing ? (
                <input className="input !py-1 text-sm mt-0.5" value={inputs[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
              ) : (
                <div className="text-sm text-brand-ink mt-0.5">{inputs[f.key] || <span className="text-brand-muted">—</span>}</div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          {editing
            ? <span className="flex gap-2"><button className="btn-primary !py-1 text-sm" onClick={saveFields}>Save details</button><button className="btn-ghost !py-1 text-sm" onClick={cancelEdit}>Cancel</button></span>
            : <button className="text-xs text-brand-greenDark hover:underline" onClick={startEdit}>Edit details</button>}
        </div>
      </section>

      {/* Next step (AI) */}
      <section className="card p-5 bg-gradient-to-br from-brand-tint to-white">
        <div className="flex items-center gap-2 mb-2">
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-brand-green/15 text-brand-greenDark"><Sparkles size={15} /></span>
          <h3 className="text-sm font-semibold">Recommended next step</h3>
          <button className="ml-auto text-brand-muted hover:text-brand-ink" onClick={() => recommend(client)} title="Refresh recommendation" disabled={nextLoading}>
            <RefreshCw size={14} className={nextLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {nextLoading ? <p className="text-sm text-brand-muted">Thinking…</p>
          : next?.action ? (
            <div>
              <p className="text-sm font-medium">{next.action}</p>
              {next.rationale && <p className="text-sm text-brand-muted mt-1">{next.rationale}</p>}
              {next.templateId && (
                <button className="btn-primary !py-1.5 text-sm mt-3" onClick={() => onStartDocument(client, next.templateId)}>
                  <Wand2 size={14} /> Create this
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-brand-muted">
              {next?.provider === 'none' ? 'Recommendations need automatic drafting configured.'
                : next?.provider === 'error' ? 'Couldn’t fetch a recommendation — try Refresh.'
                : 'No recommendation yet — add some client activity.'}
            </p>
          )}
      </section>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Left: intake + timeline */}
        <div className="space-y-5 min-w-0">
          {/* Intake */}
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold">Log an update</h3>
              <span className="text-[11px] text-brand-muted">Paste a transcript, email or bill — it’s analysed, filed and used to update the client.</span>
            </div>
            <div className="flex gap-2 mb-2">
              {(['transcript', 'email', 'bill'] as SourceKind[]).map((k) => (
                <button key={k} onClick={() => setIntakeKind(k)} aria-pressed={intakeKind === k} className={'text-xs px-2.5 py-1 rounded-lg border capitalize transition ' + (intakeKind === k ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{k}</button>
              ))}
            </div>
            <textarea className="input min-h-[90px] text-sm" placeholder="Paste the transcript / email / bill text here…" value={intakeText} onChange={(e) => setIntakeText(e.target.value)} />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button className="btn-primary !py-1.5 text-sm" onClick={analyzePasted} disabled={analyzing || !intakeText.trim()}>
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {analyzing ? 'Analysing…' : 'Analyse & log'}
              </button>
              <label className="btn-ghost !py-1.5 text-sm cursor-pointer">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Upload document
                <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAndAnalyze(f); e.target.value = ''; }} />
              </label>
              <span className="flex-1" />
              {QUICK_LOG.map((q) => (
                <button key={q.label} onClick={() => quickLog(q)} className="text-[11px] px-2 py-1 rounded-md border border-brand-line text-brand-muted hover:text-brand-ink hover:bg-brand-tint">{q.label}</button>
              ))}
            </div>
          </section>

          {/* Timeline */}
          <section className="card p-4">
            <h3 className="text-sm font-semibold mb-3">Activity timeline</h3>
            <ol className="space-y-3">
              {client.activities.map((a) => {
                const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                const isDoc = a.type === 'document' && !!a.meta?.projectId;
                return (
                  <li key={a.id} className="flex gap-3">
                    <span className="grid place-items-center h-7 w-7 rounded-full bg-brand-tint text-brand-greenDark shrink-0 mt-0.5"><Icon size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isDoc ? (
                          <button type="button" className="text-sm text-left text-brand-greenDark hover:underline font-medium" onClick={() => onOpenProject(String(a.meta!.projectId))}>
                            {a.title}<ExternalLink size={11} className="inline ml-1 -mt-0.5" />
                          </button>
                        ) : (
                          <span className="text-sm text-brand-ink">{a.title}</span>
                        )}
                        <span className="text-[11px] text-brand-muted ml-auto shrink-0">{relativeTime(a.at)}</span>
                      </div>
                      {a.detail && <p className="text-xs text-brand-muted mt-0.5 whitespace-pre-line">{a.detail}</p>}
                    </div>
                  </li>
                );
              })}
              {!client.activities.length && <li className="text-sm text-brand-muted">No activity yet.</li>}
            </ol>
          </section>
        </div>

        {/* Right: tracker + documents/files */}
        <div className="space-y-5">
          <section className="card p-4">
            <h3 className="text-sm font-semibold mb-3">Tracker</h3>
            <div className="space-y-1.5">
              {MILESTONES.map((m) => {
                const done = !!client.tracker[m.key];
                return (
                  <button key={m.key} onClick={() => toggleMilestone(m.key)} className="flex items-center gap-2 w-full text-left text-sm group">
                    {done ? <CheckCircle2 size={16} className="text-brand-green shrink-0" /> : <Circle size={16} className="text-brand-line group-hover:text-brand-muted shrink-0" />}
                    <span className={done ? 'text-brand-ink' : 'text-brand-muted'}>{m.label}</span>
                    {done && client.tracker[m.key] && <span className="text-[10px] text-brand-muted ml-auto">{new Date(client.tracker[m.key] as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Documents &amp; files</h3>
              <button className="text-xs text-brand-greenDark hover:underline inline-flex items-center gap-1" onClick={() => onStartDocument(client)}><Plus size={12} /> New</button>
            </div>
            <div className="space-y-1.5">
              {docActivities.map((a) => (
                <button key={a.id} className="flex items-center gap-2 w-full text-left text-sm hover:bg-brand-tint rounded px-1 py-0.5" onClick={() => onOpenProject(String(a.meta!.projectId))}>
                  <FileText size={13} className="text-brand-greenDark shrink-0" />
                  <span className="flex-1 truncate">{a.title.replace(/^Created /, '')}</span>
                  <ExternalLink size={12} className="text-brand-muted shrink-0" />
                </button>
              ))}
              {files.map((f) => (
                <div key={f.id} className="group flex items-center gap-2 text-sm">
                  <Paperclip size={13} className="text-brand-muted shrink-0" />
                  <a href={api.files.downloadUrl(f.id)} target="_blank" rel="noreferrer" className="flex-1 truncate hover:text-brand-green" title={f.name}>{f.name}</a>
                  {f.extractedText && <span className="text-[9px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0">read</span>}
                  <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-up shrink-0" onClick={() => removeFile(f.id)} title="Remove"><Trash2 size={12} /></button>
                </div>
              ))}
              {!docActivities.length && !files.length && <p className="text-xs text-brand-muted">No documents or files yet.</p>}
            </div>
          </section>
        </div>
      </div>

      {err && <p className="text-sm text-up">{err}</p>}
    </div>
  );
}
