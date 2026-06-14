import { useEffect, useMemo, useState } from 'react';
import {
  FileText, FilePlus2, Trash2, Pencil, Search, Building2, Clock, X, ArrowRight,
} from 'lucide-react';
import { api, type ReportProjectSummary, type ClientProfile } from '../lib/api';
import { stageLabel } from '../lib/crm';

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The Report tab's home screen: manage saved reports and client profiles in one
// overview, and start new work from either.
export function ReportHome({
  projects, onOpen, onNew, onNewForClient, onOpenClient, onRefresh,
}: {
  projects: ReportProjectSummary[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onNewForClient: (profileId: string) => void;
  onOpenClient: (id: string) => void;
  onRefresh: () => void;
}) {
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const reloadProfiles = () => api.profiles.list().then(setProfiles).catch(() => {});
  useEffect(() => { reloadProfiles(); }, []);

  const q = query.trim().toLowerCase();
  const shownProjects = useMemo(
    () => [...projects]
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .filter((p) => !q || p.name.toLowerCase().includes(q)),
    [projects, q],
  );
  const shownProfiles = profiles.filter((p) => !q || p.name.toLowerCase().includes(q));

  const renameProject = async (p: ReportProjectSummary) => {
    const name = window.prompt('Report name', p.name);
    if (!name || name === p.name) return;
    try { await api.projects.update(p.id, { name }); onRefresh(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const deleteProject = async (id: string) => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    try { await api.projects.remove(id); onRefresh(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const renameProfile = async (p: ClientProfile) => {
    const name = window.prompt('Client profile name', p.name);
    if (!name || name === p.name) return;
    try { await api.profiles.update(p.id, { name, inputs: p.inputs }); reloadProfiles(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const deleteProfile = async (id: string) => {
    if (!window.confirm('Delete this client profile? Existing reports are not affected.')) return;
    try { await api.profiles.remove(id); reloadProfiles(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Documents</h2>
          <p className="text-sm text-brand-muted mt-0.5">Client reports, follow-up emails and more — open one to keep working, or start fresh.</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
          <input
            className="input !py-2 !pl-8 !w-56 text-sm"
            placeholder="Search reports & clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-ink" onClick={() => setQuery('')} title="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        <button className="btn-primary" onClick={onNew}><FilePlus2 size={16} /> New document</button>
      </div>

      {err && <p className="text-sm text-up">{err}</p>}

      {/* Projects grid */}
      {shownProjects.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shownProjects.map((p) => (
            <div
              key={p.id}
              className="group card p-4 cursor-pointer transition hover:shadow-md hover:-translate-y-px flex flex-col gap-2"
              onClick={() => onOpen(p.id)}
            >
              <div className="flex items-start gap-2.5">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-brand-green/10 text-brand-greenDark shrink-0">
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-snug truncate" title={p.name}>{p.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-brand-muted mt-0.5">
                    <Clock size={11} /> Edited {ago(p.updatedAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-[11px] text-brand-muted">Created {new Date(p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); renameProject(p); }} title="Rename"><Pencil size={13} /></button>
                  <button className="p-1 text-brand-muted hover:text-up" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} title="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-10 text-center">
          <FileText size={28} className="mx-auto mb-3 text-brand-green opacity-60" />
          {q ? (
            <p className="text-sm text-brand-muted">No documents match “{query}”.</p>
          ) : (
            <>
              <h3 className="text-base font-semibold">No documents yet</h3>
              <p className="text-sm text-brand-muted mt-1 mb-4">Pick a template — a market report, a post-call follow-up email and more — then assemble and edit it.</p>
              <button className="btn-primary mx-auto" onClick={onNew}><FilePlus2 size={16} /> Create your first document</button>
            </>
          )}
        </div>
      )}

      {/* Clients (CRM) */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="label">Clients</div>
          <span className="text-[11px] text-brand-muted">— open a client to manage their pipeline stage, activity and documents</span>
        </div>
        {shownProfiles.length ? (
          <div className="card divide-y divide-brand-line">
            {shownProfiles.map((p) => (
              <div key={p.id} className="group flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-brand-surface transition" onClick={() => onOpenClient(p.id)}>
                <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-tint text-brand-greenDark shrink-0">
                  <Building2 size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-tint text-brand-greenDark shrink-0">{stageLabel(p.stage)}</span>
                  </div>
                  <div className="text-[11px] text-brand-muted truncate">
                    {[p.inputs.currentSupplier && `Supplier: ${p.inputs.currentSupplier}`, p.inputs.contractEnd && `Contract end: ${p.inputs.contractEnd}`, p.activities?.length ? `${p.activities.length} activities` : null]
                      .filter(Boolean).join(' · ') || 'No details yet'}
                  </div>
                </div>
                <button
                  className="btn-ghost !py-1 !px-2.5 text-xs"
                  onClick={(e) => { e.stopPropagation(); onNewForClient(p.id); }}
                  title="Create a new document for this client"
                >
                  <ArrowRight size={13} /> New document
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); renameProfile(p); }} title="Rename client"><Pencil size={13} /></button>
                  <button className="p-1 text-brand-muted hover:text-up" onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }} title="Delete client"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-brand-muted">No saved client profiles yet — they’re saved automatically when you create a report with a company name.</p>
        )}
      </section>
    </div>
  );
}
