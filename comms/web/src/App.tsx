import { lazy, Suspense } from 'react';
import { Sidebar, SECTION_LABEL, type Tab } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { IdeasBoard } from './components/IdeasBoard';
import { ClientsHome } from './components/ClientsHome';
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

  return (
    <WorkspaceProvider onNavigateToDocuments={() => setSection('documents')}>
      <Shell section={section} setSection={setSection} collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />
    </WorkspaceProvider>
  );
}

function Shell({ section, setSection, collapsed, onToggleCollapse }: {
  section: Tab;
  setSection: (t: Tab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const ws = useWorkspace();
  // The Documents studio is full-bleed; reading/CRM surfaces stay capped + centred.
  const wide = section === 'documents';

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
          {section === 'report' && <ClientsHome />}
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
