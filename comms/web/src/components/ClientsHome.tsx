import { useCallback, useEffect, useState } from 'react';
import { api, type ReportProjectSummary } from '../lib/api';
import { ReportHome } from './ReportHome';
import { ClientCreate } from './ClientCreate';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { useClientTabs } from '../workspace/ClientTabsContext';

// The Clients section in FREE mode: the CRM home (client grid + recent reports).
// Opening a client (or creating one) adds it to the universal client-tab bar and
// activates it — the App then renders that client's hub. Report creation/opening is
// delegated to the Documents workspace, so a report opens as a tab.
export function ClientsHome() {
  const ws = useWorkspace();
  const tabs = useClientTabs();
  const [projects, setProjects] = useState<ReportProjectSummary[]>([]);
  const [creatingClient, setCreatingClient] = useState(false);

  const refreshProjects = useCallback(() => api.projects.list().then(setProjects).catch(() => {}), []);
  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  return (
    <>
      {creatingClient && (
        <ClientCreate
          onCreated={(c) => { setCreatingClient(false); refreshProjects(); tabs.openClient(c.id, c.name); }}
          onCancel={() => setCreatingClient(false)}
        />
      )}
      <ReportHome
        projects={projects}
        onOpen={(id) => ws.openDocById(id)}
        onNew={() => ws.requestNewDoc({})}
        onNewClient={() => setCreatingClient(true)}
        onNewForClient={(profileId) => ws.requestNewDoc({ profileId })}
        onOpenClient={(id, name) => tabs.openClient(id, name)}
        onRefresh={refreshProjects}
      />
    </>
  );
}
