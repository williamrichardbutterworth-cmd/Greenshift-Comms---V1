import { useState } from 'react';
import { X, Globe, FileText, Paperclip, Loader2, Sparkles, ArrowLeft, ArrowRight, Check, Trash2, Building2 } from 'lucide-react';
import { api, type ClientProfile, type IntakeRunResult } from '../lib/api';
import { useBackgroundTasks } from '../workspace/BackgroundTasksContext';

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});
const domainName = (url: string): string => {
  try { return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return ''; }
};

const STEPS = [
  { key: 'website', n: 1, label: 'Website', icon: Globe, hint: 'We scrape it for a company overview + key details.' },
  { key: 'transcript', n: 2, label: 'Transcript', icon: FileText, hint: 'Paste the call — we pull out everything discussed.' },
  { key: 'media', n: 3, label: 'Media', icon: Paperclip, hint: 'Add bills or docs — we read meters, rates & dates.' },
] as const;

// A clean three-step new-client flow: paste a website, a transcript, attach media —
// then everything is queued as ONE background setup. The modal closes immediately
// and the client's hub opens with the record filling itself in: uploads run first,
// then the server does the scrape + unified extraction + merge + timeline +
// calendar commitments in a single request (intake-run).
export function ClientCreate({ onCreated, onCancel }: { onCreated: (c: ClientProfile) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [website, setWebsite] = useState('');
  const [transcript, setTranscript] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bg = useBackgroundTasks();

  const canAnalyse = !!(website.trim() || transcript.trim() || files.length);

  const analyse = async () => {
    if (!canAnalyse) { setErr('Add a website, transcript or a document to set up the client.'); return; }
    setCreating(true); setErr(null);
    try {
      // The only blocking step: a minimal shell so files/tasks have a client to
      // attach to. Everything else is a background task.
      const provisional = domainName(website) || 'New client';
      const created = await api.profiles.create({ name: provisional, inputs: {} });
      const snapFiles = files; const site = website.trim(); const text = transcript;
      bg.run<IntakeRunResult>({
        kind: 'client-intake',
        label: `Setting up ${provisional}`,
        clientId: created.id, clientName: provisional,
        // The transcript rides the payload so a transport failure can put it back
        // in the hub's log box — the pasted words must never be lost.
        payload: text.trim() ? { text } : undefined,
        fn: async () => {
          const fileIds: string[] = [];
          const images: { base64: string; mime: string }[] = [];
          for (const f of snapFiles) {
            try {
              const base64 = await fileToBase64(f);
              const saved = await api.files.upload({ name: f.name, mime: f.type, dataBase64: base64, clientProfileId: created.id });
              await api.profiles.addActivity(created.id, { type: 'file', title: `Uploaded ${f.name}`, meta: { fileId: saved.id } }).catch(() => {});
              fileIds.push(saved.id);
              if (f.type.startsWith('image/')) images.push({ base64, mime: f.type });
            } catch { /* skip a failed file */ }
          }
          return api.client.intakeRun(created.id, {
            website: site || undefined,
            transcript: text.trim() ? text : undefined,
            fileIds, images,
          });
        },
      });
      onCreated(created); // open the hub now — it shows the setup running + fills in
    } catch (e) { setErr(String((e as Error).message)); setCreating(false); }
  };

  const cur = STEPS[step];

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={creating ? undefined : onCancel}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-auto p-0" onClick={(e) => e.stopPropagation()}>
        <>
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 size={18} className="text-brand-greenDark" /> New client</h2>
              <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel} disabled={creating}><X size={16} /></button>
            </div>

            {/* Stepper */}
            <div className="flex items-center gap-1 px-5 mt-4">
              {STEPS.map((s, i) => {
                const done = i < step; const active = i === step;
                return (
                  <div key={s.key} className="flex items-center gap-1 flex-1">
                    <button onClick={() => setStep(i)} className="flex items-center gap-2 min-w-0">
                      <span className={'grid place-items-center h-7 w-7 rounded-full text-xs font-semibold shrink-0 transition ' + (done ? 'bg-brand-green text-white' : active ? 'bg-brand-greenDark text-white' : 'bg-brand-line text-brand-muted')}>
                        {done ? <Check size={14} /> : s.n}
                      </span>
                      <span className={'text-sm truncate ' + (active ? 'font-medium text-brand-ink' : 'text-brand-muted')}>{s.label}</span>
                    </button>
                    {i < STEPS.length - 1 && <span className={'h-px flex-1 ' + (done ? 'bg-brand-green' : 'bg-brand-line')} />}
                  </div>
                );
              })}
            </div>

            {/* Step body */}
            <div className="px-5 py-5 min-h-[220px]">
              <div className="flex items-center gap-2 mb-1">
                <cur.icon size={16} className="text-brand-greenDark" />
                <h3 className="text-sm font-semibold">{cur.label}</h3>
                <span className="text-[11px] text-brand-muted">{cur.hint}</span>
                <span className="text-[10px] uppercase tracking-wide text-brand-muted ml-auto">optional</span>
              </div>

              {cur.key === 'website' && (
                <input autoFocus className="input mt-2" placeholder="acme-manufacturing.co.uk" value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setStep(1); }} />
              )}
              {cur.key === 'transcript' && (
                <textarea autoFocus className="input mt-2 min-h-[150px]" placeholder="Paste the Dialpad / call transcript here — we’ll pull out the company, contact, phone number, meters, contract dates and key points…" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              )}
              {cur.key === 'media' && (
                <div className="mt-2">
                  <label className="border-2 border-dashed border-brand-line rounded-xl p-6 grid place-items-center text-center cursor-pointer hover:border-brand-green/40 hover:bg-brand-tint/30 transition">
                    <Paperclip size={20} className="text-brand-greenDark mb-1.5" />
                    <span className="text-sm font-medium">Attach bills, LOAs or documents</span>
                    <span className="text-[11px] text-brand-muted mt-0.5">PDFs &amp; Word are read for text; photos of bills are read directly</span>
                    <input type="file" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
                  </label>
                  {files.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm rounded-lg border border-brand-line px-2.5 py-1.5">
                          <FileText size={13} className="text-brand-muted shrink-0" />
                          <span className="flex-1 truncate">{f.name}</span>
                          <button className="text-brand-muted hover:text-up" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {err && <p className="text-sm text-up mt-3">{err}</p>}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-brand-line">
              {step > 0 ? <button className="btn-ghost" onClick={() => setStep(step - 1)} disabled={creating}><ArrowLeft size={15} /> Back</button> : <span />}
              <div className="flex-1" />
              {step < STEPS.length - 1 ? (
                <>
                  <button className="btn-ghost" onClick={analyse} disabled={!canAnalyse || creating} title="Set up in the background with what you've added so far">
                    {creating ? <Loader2 size={15} className="animate-spin" /> : null} Skip &amp; set up
                  </button>
                  <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={creating}>Next <ArrowRight size={15} /></button>
                </>
              ) : (
                <button className="btn-primary" onClick={analyse} disabled={!canAnalyse || creating}>
                  {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Set up in background
                </button>
              )}
            </div>
          </>
      </div>
    </div>
  );
}
