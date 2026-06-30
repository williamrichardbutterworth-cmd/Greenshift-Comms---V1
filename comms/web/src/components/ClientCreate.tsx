import { useState } from 'react';
import { X, Globe, FileText, Paperclip, Loader2, Sparkles, ArrowLeft, ArrowRight, Check, Trash2, Building2 } from 'lucide-react';
import { api, type ClientProfile, type ReportInputs } from '../lib/api';
import { mergeIntakeIntoInputs } from '../lib/clientProfile';

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

const ANALYSE_STAGES = ['Reading the website…', 'Analysing the call…', 'Reading your documents…', 'Building the client profile…'];

// A clean three-step new-client flow: paste a website, a transcript, and attach
// media — then everything is analysed at once into a comprehensive client profile
// and journey, ready to generate documents from.
export function ClientCreate({ onCreated, onCancel }: { onCreated: (c: ClientProfile) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [website, setWebsite] = useState('');
  const [transcript, setTranscript] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [stage, setStage] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const canAnalyse = !!(website.trim() || transcript.trim() || files.length);

  const analyse = async () => {
    if (!canAnalyse) { setErr('Add a website, transcript or a document to set up the client.'); return; }
    setAnalysing(true); setErr(null); setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, ANALYSE_STAGES.length - 1)), 4000);
    try {
      // 1. Minimal client up front (so files attach to it), renamed after analysis.
      const provisional = domainName(website) || 'New client';
      const created = await api.profiles.create({ name: provisional, inputs: {} });
      // 2. Upload media → text (server-extracted) for docs, base64 for images.
      const fileTexts: string[] = [];
      const images: { base64: string; mime: string }[] = [];
      for (const f of files) {
        try {
          const base64 = await fileToBase64(f);
          const saved = await api.files.upload({ name: f.name, mime: f.type, dataBase64: base64, clientProfileId: created.id });
          await api.profiles.addActivity(created.id, { type: 'file', title: `Uploaded ${f.name}`, meta: { fileId: saved.id } }).catch(() => {});
          if (f.type.startsWith('image/')) images.push({ base64, mime: f.type });
          else if (saved.extractedText?.trim()) fileTexts.push(saved.extractedText);
        } catch { /* skip a failed file */ }
      }
      // 3. One comprehensive analysis of everything.
      const r = await api.client.intake({ website: website.trim() || undefined, transcript: transcript.trim() || undefined, fileTexts, images });
      // 4. Build the profile + milestones, rename, persist.
      const inputs: ReportInputs = mergeIntakeIntoInputs({}, r);
      const tracker: Record<string, string> = {};
      for (const m of r.suggestedMilestones) tracker[m] = new Date().toISOString();
      const name = r.companyName || provisional;
      await api.profiles.update(created.id, { name, inputs, ...(Object.keys(tracker).length ? { tracker } : {}) });
      // 5. Log the journey-seeding activities.
      if (transcript.trim()) await api.profiles.addActivity(created.id, {
        type: 'transcript', title: r.summary || 'Call analysed',
        detail: r.points.length ? r.points.map((p) => `• ${p}`).join('\n') : undefined,
        meta: (r.angles.length || r.rapport.length) ? { ...(r.angles.length ? { angles: r.angles } : {}), ...(r.rapport.length ? { rapport: r.rapport } : {}) } : undefined,
      }).catch(() => {});
      // Rapport openers are largely website-derived — keep them on the website note,
      // but ONLY when there's no transcript activity already carrying them, so the
      // rapport array isn't stored on two timeline entries.
      const rapportOnTranscript = !!transcript.trim() && r.rapport.length > 0;
      if (website.trim() && r.companySummary) await api.profiles.addActivity(created.id, {
        type: 'note', title: 'Website summarised', detail: r.companySummary, meta: { website: r.websiteUrl, ...(!rapportOnTranscript && r.rapport.length ? { rapport: r.rapport } : {}) },
      }).catch(() => {});
      const finalClient = await api.profiles.get(created.id).catch(() => created);
      onCreated(finalClient);
    } catch (e) { setErr(String((e as Error).message)); setAnalysing(false); clearInterval(timer); return; }
    clearInterval(timer);
  };

  const cur = STEPS[step];

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={analysing ? undefined : onCancel}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-auto p-0" onClick={(e) => e.stopPropagation()}>
        {analysing ? (
          <div className="p-10 text-center">
            <div className="grid place-items-center h-14 w-14 rounded-2xl bg-brand-tint text-brand-greenDark mx-auto mb-4"><Loader2 size={26} className="animate-spin" /></div>
            <h2 className="text-lg font-semibold">Setting up the client</h2>
            <p className="text-sm text-brand-muted mt-1.5 min-h-[20px]">{ANALYSE_STAGES[stage]}</p>
            <p className="text-[11px] text-brand-muted mt-3">Reading everything you gave us and building the profile — a few seconds.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Building2 size={18} className="text-brand-greenDark" /> New client</h2>
              <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel}><X size={16} /></button>
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
              {step > 0 ? <button className="btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Back</button> : <span />}
              <div className="flex-1" />
              {step < STEPS.length - 1 ? (
                <>
                  <button className="btn-ghost" onClick={analyse} disabled={!canAnalyse} title="Analyse what you've added so far">Skip &amp; set up</button>
                  <button className="btn-primary" onClick={() => setStep(step + 1)}>Next <ArrowRight size={15} /></button>
                </>
              ) : (
                <button className="btn-primary" onClick={analyse} disabled={!canAnalyse}><Sparkles size={16} /> Analyse &amp; set up</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
