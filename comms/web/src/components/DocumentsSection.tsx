import { FilePlus2, X, FileText, Plus } from 'lucide-react';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { DocumentStudio } from './DocumentStudio';

// The Documents workspace: a strip of open-document tabs over the active studio.
// Open documents persist in the workspace store, so you can leave for other
// sections and come back to them intact.
export function DocumentsSection() {
  const ws = useWorkspace();
  const active = ws.activeId ? ws.sessions[ws.activeId] : null;

  return (
    <div>
      {ws.order.length > 0 && (
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-0.5 sticky top-[var(--topbar-h)] z-[21] -mx-1 px-1">
          {ws.order.map((id) => {
            const s = ws.sessions[id];
            const isActive = id === ws.activeId;
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
          <button className="btn-ghost !py-1.5 !px-2 shrink-0 ml-1" onClick={() => ws.requestNewDoc({})} title="New document">
            <Plus size={15} />
          </button>
        </div>
      )}

      {active ? (
        <DocumentStudio key={active.id} project={active.project} onProjectSaved={ws.updateProject} />
      ) : (
        <div className="card p-12 text-center max-w-xl mx-auto mt-6">
          <div className="grid place-items-center h-12 w-12 rounded-xl bg-brand-tint text-brand-greenDark mx-auto mb-3"><FileText size={22} /></div>
          <h2 className="text-lg font-semibold">No documents open</h2>
          <p className="text-sm text-brand-muted mt-1.5 mb-4">
            Open a report from a client, or start a new one. Open documents stay here as tabs while you work elsewhere in the app.
          </p>
          <button className="btn-primary mx-auto" onClick={() => ws.requestNewDoc({})}><FilePlus2 size={16} /> New document</button>
        </div>
      )}
    </div>
  );
}
