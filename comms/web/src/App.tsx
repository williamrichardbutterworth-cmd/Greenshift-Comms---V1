import { lazy, Suspense, useState } from 'react';
import { Sidebar, SECTION_LABEL, type Tab } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { IdeasBoard } from './components/IdeasBoard';
import { ClientsHome } from './components/ClientsHome';
import { LoaSection } from './components/LoaSection';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { usePersisted } from './lib/usePersisted';

// The document workspace pulls in TipTap + the chart/export libraries, so load it
// only when the Documents section is opened (keeps the rest of the app light).
const DocumentsSection = lazy(() =>
  import('./components/DocumentsSection').then((m) => ({ default: m.DocumentsSection })),
);

export default function App() {
  const [section, setSection] = usePersisted<Tab>('comms.ui.section', 'dashboard');
  const [collapsed, setCollapsed] = usePersisted<boolean>('comms.ui.sidebarCollapsed', false);
  // Deep-link target for opening a specific client's LOA editor from their hub.
  const [loaClientId, setLoaClientId] = useState<string | null>(null);
  const openLoa = (id: string) => { setLoaClientId(id); setSection('loa'); };

  return (
    <WorkspaceProvider onNavigateToDocuments={() => setSection('documents')}>
      <Shell
        section={section} setSection={setSection}
        collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)}
        loaClientId={loaClientId} onOpenLoa={openLoa} onLoaConsumed={() => setLoaClientId(null)}
      />
    </WorkspaceProvider>
  );
}

function Shell({ section, setSection, collapsed, onToggleCollapse, loaClientId, onOpenLoa, onLoaConsumed }: {
  section: Tab;
  setSection: (t: Tab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  loaClientId: string | null;
  onOpenLoa: (id: string) => void;
  onLoaConsumed: () => void;
}) {
  const ws = useWorkspace();
  // The Documents studio + the wider Clients hub are full-bleed; other surfaces stay capped.
  const wide = section === 'documents' || section === 'report';

  return (
    <div className="flex min-h-full">
      <Sidebar section={section} onChange={setSection} collapsed={collapsed} onToggleCollapse={onToggleCollapse} docCount={ws.count} />

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="h-[var(--topbar-h)] shrink-0 sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-brand-line flex items-center px-5 lg:px-8">
          <span className="text-sm font-semibold">{SECTION_LABEL[section]}</span>
        </div>

        <main className={'flex-1 w-full px-5 lg:px-8 py-6 ' + (wide ? 'max-w-wide mx-auto 3xl:px-10' : 'max-w-content mx-auto')}>
          {section === 'dashboard' && <Dashboard />}
          {section === 'brief' && <DailyReview />}
          {section === 'news' && <NewsFeed />}
          {section === 'report' && <ClientsHome onOpenLoa={onOpenLoa} />}
          {section === 'loa' && <LoaSection initialClientId={loaClientId} onConsumed={onLoaConsumed} />}
          {section === 'documents' && (
            <Suspense fallback={<div className="card p-10 text-center text-brand-muted">Loading workspace…</div>}>
              <DocumentsSection />
            </Suspense>
          )}
          {section === 'ideas' && <IdeasBoard />}
        </main>
      </div>
    </div>
  );
}
