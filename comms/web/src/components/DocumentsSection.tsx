import { useEffect, useState } from 'react';
import { FilePlus2, X, FileText, Plus, ExternalLink } from 'lucide-react';
import { api, type ClientProfile } from '../lib/api';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useClientTabs } from '../workspace/ClientTabsContext';
import { ReportStudio } from './reports/ReportStudio';

// The Reports workspace. The CLIENT (the active client tab) is the top-level unit:
// the report subtabs below belong only to that client, so all open report tabs
// relate to one client and switching the client tab switches the visible reports.
// On the Free tab it shows client-less reports. With a client active and nothing
// open, it shows that client's reports to open or create.
export function DocumentsSection({ clientId }: { clientId?: string } = {}) {
  const ws = useWorkspace();
  const tabs = useClientTabs();
  const clientName = clientId ? (tabs.openClients.find((c) => c.id === clientId)?.name ?? null) : null;

  // Only this client's open reports (client-less reports on the Free tab). The
  // "effective active" is the global active report when it belongs here, else this
  // client's first open report — so switching client tabs never shows another
  // client's report, and closing a tab can't jump focus across clients.
  const tabIds = ws.order.filter((id) => (ws.sessions[id]?.clientId ?? undefined) === (clientId ?? undefined));
  const effectiveActiveId = ws.activeId && tabIds.includes(ws.activeId) ? ws.activeId : (tabIds[0] ?? null);
  const active = effectiveActiveId ? ws.sessions[effectiveActiveId] : null;

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-brand-muted mb-2">
        {clientName ? `${clientName} · Reports` : 'Reports'}
      </div>

      {tabIds.length > 0 && (
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-0.5 sticky top-[var(--topbar-h)] z-[21] -mx-1 px-1">
          {tabIds.map((id) => {
            const s = ws.sessions[id];
            const isActive = id === effectiveActiveId;
            return (
              <div
                key={id}
                onClick={() => ws.setActive(id)}
                className={
                  'group flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm cursor-pointer shrink-0 border transition ' +
                  (isActive ? 'bg-white border-brand-line shadow-soft' : 'border-transparent text-brand-muted hover:bg-white/70')
                }
              >
                <FileText size={13} className={isActive ? 'text-brand-greenDark shrink-0' : 'shrink-0'} />
                <span className="max-w-[180px] truncate">{s?.project.name ?? 'Document'}</span>
                <button
                  className="text-brand-muted/60 hover:text-up transition"
                  onClick={(e) => { e.stopPropagation(); ws.closeDoc(id); }}
                  title="Close tab"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button className="btn-ghost !py-1.5 !px-2 shrink-0 ml-1" onClick={() => ws.requestNewDoc({ profileId: clientId })} title="New report">
            <Plus size={15} />
          </button>
        </div>
      )}

      {active ? (
        <ReportStudio key={active.id} project={active.project} onProjectSaved={ws.updateProject} />
      ) : clientId ? (
        <ClientReports
          clientId={clientId}
          onOpen={(id) => ws.openDocById(id)}
          onNew={() => ws.requestNewDoc({ profileId: clientId })}
        />
      ) : (
        <div className="card p-12 text-center max-w-xl mx-auto mt-6">
          <div className="grid place-items-center h-12 w-12 rounded-xl bg-brand-tint text-brand-greenDark mx-auto mb-3"><FileText size={22} /></div>
          <h2 className="text-lg font-semibold">No reports open</h2>
          <p className="text-sm text-brand-muted mt-1.5 mb-4">
            Open a client tab to work on their reports, or start a new one here. Open reports stay as tabs while you work elsewhere.
          </p>
          <button className="btn-primary mx-auto" onClick={() => ws.requestNewDoc({})}><FilePlus2 size={16} /> New report</button>
        </div>
      )}
    </div>
  );
}

// Client-scoped Reports landing: that client's generated reports + a "new" button.
// A client's reports are linked through its 'document' activities (meta.projectId).
function ClientReports({ clientId, onOpen, onNew }: { clientId: string; onOpen: (id: string) => void; onNew: () => void }) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  useEffect(() => { api.profiles.get(clientId).then(setClient).catch(() => setClient(null)); }, [clientId]);

  const reports = (client?.activities ?? []).filter((a) => a.type === 'document' && a.meta?.projectId);

  return (
    <div className="max-w-content mx-auto mt-2">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Reports{client ? ` — ${client.name}` : ''}</h2>
          <p className="text-sm text-brand-muted">Open one to edit, or create a new report for this client.</p>
        </div>
        <button className="btn-primary !py-1.5" onClick={onNew}><FilePlus2 size={15} /> New report</button>
      </div>
      {reports.length > 0 ? (
        <div className="card divide-y divide-brand-line">
          {reports.map((a) => (
            <button key={a.id} className="flex items-center gap-3 w-full text-left px-4 py-3 hover:bg-brand-surface transition" onClick={() => onOpen(String(a.meta!.projectId))}>
              <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-tint text-brand-greenDark shrink-0"><FileText size={14} /></span>
              <span className="flex-1 truncate text-sm font-medium">{a.title.replace(/^Created /, '')}</span>
              <ExternalLink size={14} className="text-brand-muted shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <div className="card p-10 text-center">
          <div className="grid place-items-center h-12 w-12 rounded-xl bg-brand-tint text-brand-greenDark mx-auto mb-3"><FileText size={22} /></div>
          <p className="text-sm text-brand-muted mb-4">No reports for this client yet.</p>
          <button className="btn-primary mx-auto" onClick={onNew}><FilePlus2 size={16} /> New report</button>
        </div>
      )}
    </div>
  );
}
