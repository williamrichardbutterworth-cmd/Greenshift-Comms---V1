import { useEffect, useState } from 'react';
import {
  X, Plus, Trash2, ChevronUp, ChevronDown, FileText, Mail, Type, Boxes, Loader2, Copy,
} from 'lucide-react';
import { api, type DocumentTemplate, type TemplateSection } from '../lib/api';

// Embed slots a template section can reference (kept in sync with the server's
// VALID_REF allow-list + buildDocFromSections embedNode handling).
const EMBED_OPTIONS: { ref: string; label: string }[] = [
  { ref: 'marketSnapshot', label: 'Market data table' },
  { ref: 'generationMap', label: 'Generation map' },
  { ref: 'selectedNews', label: 'Selected news / evidence' },
  { ref: 'chart:gas:12m', label: 'Gas price chart (12m)' },
  { ref: 'chart:power:12m', label: 'Power price chart (12m)' },
  { ref: 'chart:brent:12m', label: 'Brent price chart (12m)' },
];

const blank = (): DocumentTemplate => ({
  id: '', name: '', description: '', channel: 'document', icon: 'FileText', guidance: '', sections: [], builtin: false, createdAt: '',
});

// Create / edit / duplicate a document template. Built-ins are saved as a new
// custom copy (they're not mutated); custom templates are updated in place.
export function TemplateEditor({
  template, forceDuplicate, onSaved, onDeleted, onCancel,
}: {
  template: DocumentTemplate | null;
  forceDuplicate?: boolean;
  onSaved: (t: DocumentTemplate) => void;
  onDeleted?: (id: string) => void;
  onCancel: () => void;
}) {
  const base = template ?? blank();
  const duplicating = forceDuplicate || base.builtin;
  const [name, setName] = useState(duplicating && base.name ? `${base.name} (copy)` : base.name);
  const [description, setDescription] = useState(base.description);
  const [channel, setChannel] = useState<'document' | 'email'>(base.channel);
  const [guidance, setGuidance] = useState(base.guidance);
  const [sections, setSections] = useState<TemplateSection[]>(base.sections.map((s) => ({ ...s })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const editingExisting = !!base.id && !duplicating;

  const setSec = (i: number, patch: Partial<TemplateSection>) =>
    setSections((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addText = () => setSections((a) => [...a, { kind: 'text', heading: '', guidance: '' }]);
  const addEmbed = () => setSections((a) => [...a, { kind: 'embed', heading: '', ref: 'marketSnapshot' }]);
  const removeSec = (i: number) => setSections((a) => a.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setSections((a) => {
    const j = i + dir; if (j < 0 || j >= a.length) return a;
    const next = [...a]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });

  const save = async () => {
    setBusy(true); setErr(null);
    const payload = { name, description, channel, icon: channel === 'email' ? 'Mail' : 'FileText', guidance, sections };
    try {
      const saved = editingExisting ? await api.templates.update(base.id, payload) : await api.templates.create(payload);
      onSaved(saved);
    } catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  };

  const del = async () => {
    if (!editingExisting || !onDeleted) return;
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    setBusy(true);
    try { await api.templates.remove(base.id); onDeleted(base.id); }
    catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-brand-ink/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="card w-full max-w-2xl max-h-[92vh] overflow-auto p-5" role="dialog" aria-modal="true" aria-label="Template editor" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">
            {editingExisting ? 'Edit template' : duplicating && base.name ? 'Duplicate template' : 'New template'}
          </h2>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel} title="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-brand-muted mb-4">Define a reusable document or email you can generate for any client.</p>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label block mb-1">Template name</label>
              <input className="input" placeholder="e.g. Quarterly market update" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label block mb-1">Output</label>
              <div className="inline-flex rounded-lg border border-brand-line overflow-hidden text-sm w-full">
                {(['document', 'email'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => { setChannel(c); if (c === 'email') setSections((a) => a.filter((s) => s.kind === 'text')); }}
                    className={'flex-1 px-3 py-2 inline-flex items-center justify-center gap-1.5 capitalize ' + (channel === c ? 'bg-brand-green text-white' : 'bg-white text-brand-muted hover:bg-brand-tint')}>
                    {c === 'email' ? <Mail size={14} /> : <FileText size={14} />} {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="label block mb-1">Short description</label>
            <input className="input" placeholder="When would an agent reach for this?" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <label className="label block mb-1">Overall guidance</label>
            <textarea className="input min-h-[64px] text-sm" placeholder="Purpose, tone and audience — steers the whole document." value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="label">Sections {sections.length ? `(${sections.length})` : ''}</div>
              <span className="text-[11px] text-brand-muted">
                {channel === 'email' ? 'Email parts flow into one message — headings are ignored.' : 'Ordered sections the draft will follow.'}
              </span>
            </div>
            <div className="space-y-2">
              {sections.map((s, i) => (
                <div key={i} className="border border-brand-line rounded-lg p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-brand-greenDark bg-brand-tint px-1.5 py-0.5 rounded">
                      {s.kind === 'embed' ? <><Boxes size={11} /> Data</> : <><Type size={11} /> Text</>}
                    </span>
                    {channel !== 'email' && (
                      <input className="input !py-1 text-sm flex-1" placeholder="Heading (optional)" value={s.heading ?? ''} onChange={(e) => setSec(i, { heading: e.target.value })} />
                    )}
                    <div className="flex-1" />
                    <button className="text-brand-muted hover:text-brand-ink" onClick={() => move(i, -1)} title="Move up"><ChevronUp size={15} /></button>
                    <button className="text-brand-muted hover:text-brand-ink" onClick={() => move(i, 1)} title="Move down"><ChevronDown size={15} /></button>
                    <button className="text-brand-muted hover:text-up" onClick={() => removeSec(i)} title="Remove"><Trash2 size={14} /></button>
                  </div>
                  {s.kind === 'embed' ? (
                    <select className="input !py-1 text-sm" value={s.ref ?? 'marketSnapshot'} onChange={(e) => setSec(i, { ref: e.target.value })}>
                      {EMBED_OPTIONS.map((o) => <option key={o.ref} value={o.ref}>{o.label}</option>)}
                    </select>
                  ) : (
                    <textarea className="input !py-1.5 min-h-[48px] text-sm" placeholder="What should the draft write here?" value={s.guidance ?? ''} onChange={(e) => setSec(i, { guidance: e.target.value })} />
                  )}
                </div>
              ))}
              {!sections.length && <p className="text-xs text-brand-muted">No sections yet — add a text section or a data block.</p>}
            </div>
            <div className="flex gap-2 mt-2">
              <button className="btn-ghost !py-1.5 text-sm" onClick={addText}><Plus size={14} /> Text section</button>
              {channel !== 'email' && <button className="btn-ghost !py-1.5 text-sm" onClick={addEmbed}><Plus size={14} /> Data block</button>}
            </div>
          </div>
        </div>

        {err && <p className="text-sm text-up mt-3">{err}</p>}

        <div className="flex items-center gap-2 mt-5">
          {editingExisting && onDeleted && (
            <button className="btn-ghost !text-up !border-up/30" onClick={del} disabled={busy}><Trash2 size={15} /> Delete</button>
          )}
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : duplicating ? <Copy size={16} /> : <Plus size={16} />}
            {editingExisting ? 'Save template' : duplicating && base.name ? 'Save copy' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  );
}
