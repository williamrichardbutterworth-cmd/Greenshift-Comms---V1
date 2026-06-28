import { useEffect, useMemo, useState } from 'react';
import {
  FileText, FilePlus2, Trash2, Pencil, Search, Building2, Clock, X, ArrowRight, UserPlus,
} from 'lucide-react';
import { api, type ReportProjectSummary, type ClientProfile } from '../lib/api';
import { stageLabel } from '../lib/crm';
import { getReportTemplate } from '../reports/registry';

function ago(iso: string): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The Clients tab home: a client-first overview. Lead with the client cards
// (click in to track & progress), with recent documents available below.
export function ReportHome({
  projects, onOpen, onNew, onNewClient, onNewForClient, onOpenClient, onRefresh,
}: {
  projects: ReportProjectSummary[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onNewClient: () => void;
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
  const shownProfiles = useMemo(
    () => profiles.filter((p) => !q || (p.name ?? '').toLowerCase().includes(q) || (p.inputs?.currentSupplier ?? '').toLowerCase().includes(q)),
    [profiles, q],
  );
  // Only show engine reports — legacy projects (from the old editor) can't be opened.
  const recentDocs = useMemo(
    () => [...projects]
      .filter((p) => getReportTemplate(p.templateId))
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .filter((p) => !q || (p.name ?? '').toLowerCase().includes(q))
      .slice(0, 8),
    [projects, q],
  );

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
    const name = window.prompt('Client name', p.name);
    if (!name || name === p.name) return;
    try { await api.profiles.update(p.id, { name, inputs: p.inputs }); reloadProfiles(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const deleteProfile = async (id: string) => {
    if (!window.confirm('Delete this client? Their documents are not deleted.')) return;
    try { await api.profiles.remove(id); reloadProfiles(); }
    catch (e) { setErr(String((e as Error).message)); }
  };

  const docCount = (p: ClientProfile) => (p.activities ?? []).filter((a) => a.type === 'document').length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">Clients</h2>
          <p className="text-sm text-brand-muted mt-0.5">Create, track and progress your clients — open one to manage their pipeline, dialogue and documents.</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
          <input className="input !py-2 !pl-8 !w-56 text-sm" placeholder="Search clients…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-muted hover:text-brand-ink" onClick={() => setQuery('')} title="Clear search"><X size={13} /></button>
          )}
        </div>
        <button className="btn-ghost" onClick={onNew}><FilePlus2 size={16} /> New report</button>
        <button className="btn-primary" onClick={onNewClient}><UserPlus size={16} /> New client</button>
      </div>

      {err && <p className="text-sm text-up" role="alert">{err}</p>}

      {/* Clients grid (primary) */}
      {shownProfiles.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shownProfiles.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`Open client ${p.name || 'Untitled'}`}
              className="group card p-4 cursor-pointer transition hover:shadow-md hover:-translate-y-px flex flex-col gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
              onClick={() => onOpenClient(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenClient(p.id); } }}
            >
              <div className="flex items-start gap-2.5">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-brand-green/10 text-brand-greenDark shrink-0"><Building2 size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-snug truncate" title={p.name}>{p.name || 'Untitled client'}</div>
                  <span className="inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-tint text-brand-greenDark mt-1">{stageLabel(p.stage)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                  <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); renameProfile(p); }} title="Rename client"><Pencil size={13} /></button>
                  <button className="p-1 text-brand-muted hover:text-up" onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }} title="Delete client"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="text-[11px] text-brand-muted leading-relaxed">
                {[p.inputs?.currentSupplier && `Supplier: ${p.inputs.currentSupplier}`, p.inputs?.contractEnd && `Contract end: ${p.inputs.contractEnd}`, p.inputs?.consumption]
                  .filter(Boolean).join(' · ') || 'No details yet'}
              </div>
              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-[11px] text-brand-muted inline-flex items-center gap-1">
                  <Clock size={11} /> {ago(p.updatedAt)}{docCount(p) ? ` · ${docCount(p)} doc${docCount(p) > 1 ? 's' : ''}` : ''}
                </span>
                <button className="text-xs text-brand-greenDark inline-flex items-center gap-1 hover:underline opacity-0 group-hover:opacity-100 transition" onClick={(e) => { e.stopPropagation(); onNewForClient(p.id); }}>
                  New document <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card p-10 text-center">
          <Building2 size={28} className="mx-auto mb-3 text-brand-green opacity-60" />
          {q ? (
            <p className="text-sm text-brand-muted">No clients match “{query}”.</p>
          ) : (
            <>
              <h3 className="text-base font-semibold">No clients yet</h3>
              <p className="text-sm text-brand-muted mt-1 mb-4">Create a client — paste or upload a bill, transcript or email and we’ll draft their details for you.</p>
              <button className="btn-primary mx-auto" onClick={onNewClient}><UserPlus size={16} /> Create your first client</button>
            </>
          )}
        </div>
      )}

      {/* Recent documents (secondary) */}
      {recentDocs.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <div className="label">Recent reports</div>
            <span className="text-[11px] text-brand-muted">— or open a client above to see all of theirs</span>
          </div>
          <div className="card divide-y divide-brand-line">
            {recentDocs.map((p) => (
              <div key={p.id} role="button" tabIndex={0} aria-label={`Open document ${p.name || 'Untitled'}`} className="group flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-brand-surface transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green" onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p.id); } }}>
                <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-tint text-brand-greenDark shrink-0"><FileText size={15} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate" title={p.name}>{p.name}</div>
                  <div className="text-[11px] text-brand-muted">{getReportTemplate(p.templateId)?.name ?? 'Report'} · edited {ago(p.updatedAt)}</div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button className="p-1 text-brand-muted hover:text-brand-ink" onClick={(e) => { e.stopPropagation(); renameProject(p); }} title="Rename"><Pencil size={13} /></button>
                  <button className="p-1 text-brand-muted hover:text-up" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} title="Delete"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
