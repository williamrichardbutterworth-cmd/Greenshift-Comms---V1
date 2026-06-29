import { useCallback, useEffect, useState } from 'react';
import { api, type ReportProjectSummary } from '../lib/api';
import { ReportHome } from './ReportHome';
import { ClientHub } from './ClientHub';
import { ClientCreate } from './ClientCreate';
import { useWorkspace } from '../workspace/WorkspaceContext';

// The Clients section: the CRM home (client grid + recent documents) and the
// per-client hub. Document creation/opening is delegated to the Documents
// workspace, so a report opens as a tab and you keep your place here.
export function ClientsHome({ onOpenLoa, onOpenRfq }: { onOpenLoa: (clientId: string) => void; onOpenRfq: (clientId: string) => void }) {
  const ws = useWorkspace();
  const [projects, setProjects] = useState<ReportProjectSummary[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [creatingClient, setCreatingClient] = useState(false);

  const refreshProjects = useCallback(() => api.projects.list().then(setProjects).catch(() => {}), []);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  return (
    <>
      {creatingClient && (
        <ClientCreate
          onCreated={(c) => { setCreatingClient(false); refreshProjects(); setActiveClientId(c.id); }}
          onCancel={() => setCreatingClient(false)}
        />
      )}
      {activeClientId ? (
        <ClientHub
          clientId={activeClientId}
          onBack={() => setActiveClientId(null)}
          onStartDocument={(client, templateId) => ws.requestNewDoc({ profileId: client.id, templateId })}
          onDraftFromAngles={(client, angles) => ws.requestNewDoc({ profileId: client.id, templateId: 'builtin-post-call-followup', seedAngles: angles })}
          onOpenProject={(id) => ws.openDocById(id)}
          onOpenLoa={onOpenLoa}
          onOpenRfq={onOpenRfq}
        />
      ) : (
        <ReportHome
          projects={projects}
          onOpen={(id) => ws.openDocById(id)}
          onNew={() => ws.requestNewDoc({})}
          onNewClient={() => setCreatingClient(true)}
          onNewForClient={(profileId) => ws.requestNewDoc({ profileId })}
          onOpenClient={(id) => setActiveClientId(id)}
          onRefresh={refreshProjects}
        />
      )}
    </>
  );
}
