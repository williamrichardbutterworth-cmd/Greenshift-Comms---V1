import { useEffect, useRef, useState } from 'react';
import { X, LineChart, Sparkles, Loader2, Paperclip, CheckCircle2, Save, Trash2 } from 'lucide-react';
import { api, type ForwardCurveSnapshot, type CommodityCurve, type NewForwardCurve } from '../lib/api';
import { commodityLabel } from '../lib/forwardCurve';

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});

interface Draft { asOfDate: string; source: string; note: string; curves: CommodityCurve[] }

// Capture today's forward curve: paste the morning report text or drop a
// screenshot/PDF → we read the power + gas season tables → review/correct →
// save a dated snapshot. (No OCR dependency: screenshots go to the model.)
export function ForwardCurveIntake({ onSaved, onCancel }: { onSaved: (s: ForwardCurveSnapshot) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const dirty = !!(text.trim() || file || draft);
  const requestClose = () => { if (busy) return; if (!dirty || window.confirm('Discard this capture? Your changes will be lost.')) onCancel(); };

  // Escape-to-close (guarded). Re-subscribes when state changes so `dirty` is fresh.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, file, draft, busy]);

  // Focus management: trap Tab within the dialog and restore focus to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const f = [...root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onTab);
    return () => { window.removeEventListener('keydown', onTab); opener?.focus?.(); };
  }, []);

  const analyse = async () => {
    if (!text.trim() && !file) return;
    setExtracting(true); setErr(null);
    try {
      const image = file ? { base64: await fileToBase64(file), mime: file.type || 'image/png' } : undefined;
      const res = await api.forwardCurve.extract({ text: text.trim() || undefined, image });
      setProvider(res.provider);
      if (!res.curves.length) { setErr(res.error || 'No forward-price tables were found — paste the tables or a clearer screenshot.'); return; }
      setDraft({
        asOfDate: res.asOfDate || new Date().toISOString().slice(0, 10),
        source: res.source || 'TotalEnergies — Energy Market Price',
        note: '',
        curves: res.curves,
      });
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setExtracting(false); }
  };

  const setMeta = (k: 'asOfDate' | 'source' | 'note', v: string) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const setLeg = (ci: number, li: number, field: 'label' | 'latest' | 'prev' | 'current', v: string) =>
    setDraft((d) => {
      if (!d) return d;
      const val = field === 'label' ? v : (v.trim() === '' ? null : Number(v));
      const curves = d.curves.map((c, i) => (i !== ci ? c : { ...c, legs: c.legs.map((l, j) => (j !== li ? l : { ...l, [field]: val })) }));
      return { ...d, curves };
    });
  const removeLeg = (ci: number, li: number) =>
    setDraft((d) => (d ? { ...d, curves: d.curves.map((c, i) => (i !== ci ? c : { ...c, legs: c.legs.filter((_, j) => j !== li) })) } : d));

  const save = async () => {
    if (!draft) return;
    const curves = draft.curves.filter((c) => c.legs.length);
    if (!curves.length) { setErr('Nothing to save — add at least one contract row.'); return; }
    setBusy(true); setErr(null);
    try {
      const payload: NewForwardCurve = { asOfDate: draft.asOfDate || undefined, source: draft.source, note: draft.note || undefined, curves };
      const saved = await api.forwardCurve.save(payload);
      onSaved(saved);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={requestClose}>
      <div ref={dialogRef} className="card w-full max-w-3xl max-h-[92vh] overflow-auto p-5" role="dialog" aria-modal="true" aria-label="Capture forward curve" aria-busy={extracting || busy} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><LineChart size={18} className="text-brand-greenDark" /> Today’s market data</h2>
          <button className="btn-ghost !px-1.5 !py-1" onClick={requestClose} title="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-brand-muted mb-4">Paste this morning’s market report, or drop a screenshot / PDF of it. We’ll read the UK power baseload and NBP gas season tables — check the numbers, then save.</p>

        {/* Source input */}
        <div className="card p-3 bg-gradient-to-br from-brand-tint to-white mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={15} className="text-brand-green" />
            <span className="text-sm font-medium">Read the report</span>
          </div>
          <textarea autoFocus className="input min-h-[90px] text-sm bg-white" placeholder="Paste the report text (the UK Baseload Prices and NBP Prices tables), then Read — or upload a screenshot / PDF below…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button className="btn-primary !py-1.5 text-sm" onClick={analyse} disabled={extracting || (!text.trim() && !file)}>
              {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {extracting ? 'Reading…' : 'Read tables'}
            </button>
            <label className="btn-ghost !py-1.5 text-sm cursor-pointer">
              <Paperclip size={14} /> {file ? file.name.slice(0, 30) : 'Upload screenshot / PDF'}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            {draft && <span className="text-[11px] text-brand-greenDark inline-flex items-center gap-1 ml-auto"><CheckCircle2 size={13} /> Read {draft.curves.length} table(s) · {draft.curves.reduce((n, c) => n + c.legs.length, 0)} rows</span>}
          </div>
        </div>

        {/* Editable grid */}
        {draft && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label block mb-1">Report date</label>
                <input type="date" className="input !py-1.5 text-sm" value={draft.asOfDate} onChange={(e) => setMeta('asOfDate', e.target.value)} />
              </div>
              <div>
                <label className="label block mb-1">Source</label>
                <input className="input !py-1.5 text-sm" value={draft.source} onChange={(e) => setMeta('source', e.target.value)} />
              </div>
            </div>

            {draft.curves.map((c, ci) => (
              <div key={c.commodity} className="card p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold">{commodityLabel(c.commodity)}</span>
                  <span className="text-[11px] text-brand-muted">{c.unit}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-brand-muted">
                        <th className="text-left font-medium py-1 pr-2">Contract</th>
                        <th className="text-right font-medium py-1 px-1.5">Latest</th>
                        <th className="text-right font-medium py-1 px-1.5">Previous</th>
                        <th className="text-right font-medium py-1 px-1.5">Current</th>
                        <th className="w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {c.legs.map((l, li) => (
                        <tr key={li} className="border-t border-brand-line">
                          <td className="py-0.5 pr-2"><input className="input !py-1 !px-2 text-sm w-24" value={l.label} onChange={(e) => setLeg(ci, li, 'label', e.target.value)} /></td>
                          <td className="py-0.5 px-1.5"><input type="number" step="0.01" className="input !py-1 !px-2 text-sm w-24 text-right font-mono" value={l.latest ?? ''} onChange={(e) => setLeg(ci, li, 'latest', e.target.value)} /></td>
                          <td className="py-0.5 px-1.5"><input type="number" step="0.01" className="input !py-1 !px-2 text-sm w-24 text-right font-mono" value={l.prev ?? ''} onChange={(e) => setLeg(ci, li, 'prev', e.target.value)} /></td>
                          <td className="py-0.5 px-1.5"><input type="number" step="0.01" className="input !py-1 !px-2 text-sm w-24 text-right font-mono" value={l.current ?? ''} onChange={(e) => setLeg(ci, li, 'current', e.target.value)} /></td>
                          <td className="py-0.5"><button className="p-1 text-brand-muted hover:text-up" onClick={() => removeLeg(ci, li)} title="Remove row"><Trash2 size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {err && <p className="text-sm text-up mt-3" role="alert">{err}</p>}
        {provider === 'none' && !draft && <p className="text-[11px] text-brand-muted mt-2">Automatic reading isn’t configured — you can still type the numbers into a saved snapshot once reading is set up.</p>}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={requestClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || !draft} title={draft ? undefined : 'Read a report first'}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Saving…' : 'Save snapshot'}
          </button>
        </div>
      </div>
    </div>
  );
}
