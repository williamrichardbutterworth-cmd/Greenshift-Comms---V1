import { useEffect, useState } from 'react';
import { X, FileText, Sparkles, Loader2, FilePlus2 } from 'lucide-react';
import { api, EMPTY_DOC, type ReportInputs, type ClientProfile, type ReportProject } from '../lib/api';

const FIELDS: { key: keyof ReportInputs; label: string; placeholder: string; wide?: boolean }[] = [
  { key: 'companyName', label: 'Company', placeholder: 'Acme Manufacturing Ltd', wide: true },
  { key: 'clientName', label: 'Contact name', placeholder: 'Jane Smith' },
  { key: 'contact', label: 'Contact detail', placeholder: 'jane@acme.co.uk' },
  { key: 'sites', label: 'Sites / meters', placeholder: '3 sites · 4 MPANs' },
  { key: 'currentSupplier', label: 'Current supplier', placeholder: 'British Gas' },
  { key: 'contractEnd', label: 'Contract end', placeholder: 'Sep 2026' },
  { key: 'consumption', label: 'Annual consumption', placeholder: '450,000 kWh' },
];

// Step 1 of report creation: build (or pick) the client profile, optionally
// pre-filled from a pasted call transcript, then create the project.
export function ClientProfileForm({ onDone, onCancel }: { onDone: (p: ReportProject) => void; onCancel: () => void }) {
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [inputs, setInputs] = useState<ReportInputs>({});
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.profiles.list().then(setProfiles).catch(() => {}); }, []);

  const set = (k: keyof ReportInputs, v: string) => setInputs((s) => ({ ...s, [k]: v }));
  const pickSaved = (id: string) => {
    setSelectedId(id);
    const p = profiles.find((x) => x.id === id);
    setInputs(p ? { ...p.inputs } : {});
  };

  const extract = async () => {
    if (!transcript.trim()) return;
    setExtracting(true);
    setExtractMsg(null);
    try {
      const res = await api.extractTranscript(transcript);
      if (res.error) { setExtractMsg(`Couldn’t extract: ${res.error.slice(0, 120)}`); return; }
      setInputs((s) => {
        const next: ReportInputs = { ...s };
        for (const [k, v] of Object.entries(res.profile)) if (v) (next as Record<string, string>)[k] = v as string;
        if (res.points.length) {
          const block = 'From the call:\n' + res.points.map((p) => `• ${p}`).join('\n');
          next.agentNotes = next.agentNotes ? `${next.agentNotes}\n\n${block}` : block;
        }
        return next;
      });
      setExtractMsg(`Applied ${Object.keys(res.profile).length} field(s) and ${res.points.length} note(s).`);
    } catch (e) {
      setExtractMsg(String((e as Error).message).slice(0, 120));
    } finally {
      setExtracting(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Save (or update) the reusable profile, then create the linked project.
      if (selectedId) await api.profiles.update(selectedId, { inputs }).catch(() => {});
      else if (inputs.companyName?.trim()) await api.profiles.create({ inputs }).catch(() => {});
      const name = inputs.companyName?.trim() ? `${inputs.companyName.trim()} — report` : 'Untitled report';
      const project = await api.projects.create({ name, inputs, doc: EMPTY_DOC });
      onDone(project);
    } catch (e) {
      setErr(String((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">New report — client profile</h2>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel} title="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-brand-muted mb-4">Capture the client’s details first — these become the report header and steer the draft.</p>

        {profiles.length > 0 && (
          <div className="mb-4">
            <label className="label block mb-1">Start from a saved client</label>
            <select className="input" value={selectedId} onChange={(e) => pickSaved(e.target.value)}>
              <option value="">New client…</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
              <label className="label block mb-1">{f.label}</label>
              <input className="input" placeholder={f.placeholder} value={inputs[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="label block mb-1">Notes / projections</label>
            <textarea className="input min-h-[64px]" placeholder="Budget, risk appetite, renewal goals…" value={inputs.agentNotes ?? ''} onChange={(e) => set('agentNotes', e.target.value)} />
          </div>
        </div>

        <div className="mt-4 border-t border-brand-line pt-3">
          <button className="text-sm text-brand-greenDark flex items-center gap-1.5 hover:underline" onClick={() => setShowTranscript((v) => !v)}>
            <FileText size={14} /> {showTranscript ? 'Hide transcript' : 'Paste a call transcript to pre-fill'}
          </button>
          {showTranscript && (
            <div className="mt-2 space-y-2">
              <textarea
                className="input min-h-[100px]"
                placeholder="Paste the Dialpad / call transcript here — we’ll pull out the client details and key points…"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-ghost !py-1.5" onClick={extract} disabled={extracting || !transcript.trim()}>
                  {extracting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Extract details
                </button>
                {extractMsg && <span className="text-xs text-brand-muted">{extractMsg}</span>}
              </div>
            </div>
          )}
        </div>

        {err && <p className="text-sm text-up mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy}>
            <FilePlus2 size={16} /> {busy ? 'Creating…' : 'Create report'}
          </button>
        </div>
      </div>
    </div>
  );
}
