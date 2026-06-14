import { useEffect, useState } from 'react';
import {
  X, FileText, Mail, CalendarClock, Plus, Pencil, Copy, Loader2, ArrowRight,
} from 'lucide-react';
import { api, type DocumentTemplate } from '../lib/api';
import { TemplateEditor } from './TemplateEditor';

const ICONS: Record<string, typeof FileText> = { FileText, Mail, CalendarClock };
const iconFor = (t: DocumentTemplate) => ICONS[t.icon ?? ''] ?? (t.channel === 'email' ? Mail : FileText);

// Step 0 of creating a document: choose which template to build. Doubles as a
// lightweight template manager (create / edit / duplicate your own).
export function DocumentTypePicker({
  onPick, onCancel,
}: {
  onPick: (t: DocumentTemplate) => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ template: DocumentTemplate | null; duplicate?: boolean } | null>(null);

  const reload = () => {
    setLoading(true);
    return api.templates.list().then(setTemplates).catch((e) => setErr(String((e as Error).message))).finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    // Escape closes the picker (but not while the editor sub-modal is open).
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onCancel]);

  return (
    <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-auto p-5" role="dialog" aria-modal="true" aria-label="New document" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">New document</h2>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel} title="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-brand-muted mb-4">Choose what to create. Each template builds a branded, client-ready document or email — set up once, reuse for any client.</p>

        {err && <p className="text-sm text-up mb-3">{err}</p>}
        {loading ? (
          <div className="h-40 grid place-items-center"><Loader2 size={20} className="animate-spin text-brand-green" /></div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {templates.map((t) => {
              const Icon = iconFor(t);
              return (
                <div key={t.id} className="group card p-4 cursor-pointer transition hover:shadow-md hover:-translate-y-px flex flex-col" onClick={() => onPick(t)}>
                  <div className="flex items-start gap-2.5">
                    <span className="grid place-items-center h-9 w-9 rounded-lg bg-brand-green/10 text-brand-greenDark shrink-0"><Icon size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{t.name}</span>
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-tint text-brand-greenDark shrink-0">{t.channel}</span>
                      </div>
                      <p className="text-xs text-brand-muted mt-0.5 leading-snug">{t.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-1">
                    <span className="text-xs text-brand-greenDark inline-flex items-center gap-1 font-medium">Use this <ArrowRight size={12} /></span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      {t.builtin ? (
                        <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); setEditing({ template: t, duplicate: true }); }} title="Duplicate &amp; edit"><Copy size={13} /></button>
                      ) : (
                        <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); setEditing({ template: t }); }} title="Edit template"><Pencil size={13} /></button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* New template card */}
            <button
              className="card p-4 border-dashed text-brand-muted hover:text-brand-greenDark hover:border-brand-green/50 transition flex flex-col items-center justify-center gap-1.5 min-h-[104px]"
              onClick={() => setEditing({ template: null })}
            >
              <Plus size={20} />
              <span className="text-sm font-medium">New template</span>
              <span className="text-[11px]">Define your own document or email</span>
            </button>
          </div>
        )}
      </div>

      {editing && (
        <TemplateEditor
          template={editing.template}
          forceDuplicate={editing.duplicate}
          onSaved={(t) => { setEditing(null); reload().then(() => onPick(t)); }}
          onDeleted={() => { setEditing(null); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
