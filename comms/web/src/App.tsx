import { lazy, Suspense, useCallback } from 'react';
import { Sidebar, SECTION_LABEL, type Tab } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { IdeasBoard } from './components/IdeasBoard';
import { ClientsHome } from './components/ClientsHome';
import { ClientHub } from './components/ClientHub';
import { EmailsSection } from './components/EmailsSection';
import { LoaSection } from './components/LoaSection';
import { RfqSection } from './components/RfqSection';
import { BillAnalysis } from './components/BillAnalysis';
import { ClientTabBar } from './components/ClientTabBar';
import { BackgroundTasksIndicator, BackgroundToasts } from './components/BackgroundTasks';
import { AmbientBackground } from './components/AmbientBackground';
import { WorkspaceProvider, useWorkspace } from './workspace/WorkspaceContext';
import { ClientTabsProvider, useClientTabs } from './workspace/ClientTabsContext';
import { BackgroundTasksProvider, type BgTask } from './workspace/BackgroundTasksContext';
import { usePersisted } from './lib/usePersisted';

// The document workspace pulls in TipTap + the chart/export libraries, so load it
// only when the Reports section is opened (keeps the rest of the app light).
const DocumentsSection = lazy(() =>
  import('./components/DocumentsSection').then((m) => ({ default: m.DocumentsSection })),
);

export default function App() {
  const [section, setSection] = usePersisted<Tab>('comms.ui.section', 'dashboard');
  const [collapsed, setCollapsed] = usePersisted<boolean>('comms.ui.sidebarCollapsed', false);

  return (
    <ClientTabsProvider>
      <WorkspaceProvider onNavigateToDocuments={() => setSection('documents')}>
        <Shell
          section={section}
          setSection={setSection}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </WorkspaceProvider>
    </ClientTabsProvider>
  );
}

function Shell({ section, setSection, collapsed, onToggleCollapse }: {
  section: Tab;
  setSection: (t: Tab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const ws = useWorkspace();
  const tabs = useClientTabs();
  const activeClientId = tabs.activeClientId; // null on the Free tab

  // Client-work sections render wide; the market-intelligence sections stay capped.
  const wide = ['report', 'emails', 'bills', 'loa', 'rfq', 'documents'].includes(section);

  // "Open" on a finished background task → jump to its client + the relevant section.
  const onOpenTask = useCallback((task: BgTask) => {
    if (task.clientId) tabs.openClient(task.clientId, task.clientName);
    if (task.kind === 'bill') setSection('bills');
    else if (task.clientId) setSection('report');
  }, [tabs, setSection]);

  return (
    <BackgroundTasksProvider onOpenTask={onOpenTask}>
    <div className="flex min-h-full">
      <AmbientBackground />
      <Sidebar section={section} onChange={setSection} collapsed={collapsed} onToggleCollapse={onToggleCollapse} docCount={ws.count} />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col">
        {/* Universal client-tab bar + background-activity indicator */}
        <div className="h-[var(--topbar-h)] shrink-0 sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-brand-line flex items-center gap-3 px-3 lg:px-4">
          <ClientTabBar />
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className="text-[11px] uppercase tracking-wide text-brand-muted hidden sm:block">{SECTION_LABEL[section]}</span>
            <BackgroundTasksIndicator />
          </div>
        </div>

        <main className={'flex-1 w-full px-5 lg:px-8 py-6 ' + (wide ? 'max-w-wide mx-auto 3xl:px-10' : 'max-w-content mx-auto')}>
          {section === 'dashboard' && <Dashboard />}
          {section === 'brief' && <DailyReview />}
          {section === 'news' && <NewsFeed />}

          {section === 'report' && (activeClientId ? (
            <ClientHub
              key={activeClientId}
              clientId={activeClientId}
              onBack={() => tabs.goFree()}
              onStartDocument={(client, templateId) => ws.requestNewDoc({ profileId: client.id, templateId })}
              onDraftFromAngles={(client, angles) => ws.requestNewDoc({ profileId: client.id, templateId: 'builtin-post-call-followup', seedAngles: angles })}
              onOpenProject={(id) => ws.openDocById(id)}
              onOpenLoa={() => setSection('loa')}
              onOpenRfq={() => setSection('rfq')}
              onOpenBills={() => setSection('bills')}
            />
          ) : (
            <ClientsHome />
          ))}

          {/* Keyed by the active client so switching client context remounts cleanly
              (no stale selection from the previous client / Free). */}
          {section === 'emails' && <EmailsSection clientId={activeClientId} />}
          {section === 'bills' && <BillAnalysis key={activeClientId ?? 'free'} initialClientId={activeClientId ?? undefined} />}
          {section === 'loa' && <LoaSection key={activeClientId ?? 'free'} initialClientId={activeClientId ?? undefined} onExit={activeClientId ? () => setSection('report') : undefined} />}
          {section === 'rfq' && <RfqSection key={activeClientId ?? 'free'} initialClientId={activeClientId ?? undefined} onExit={activeClientId ? () => setSection('report') : undefined} />}

          {section === 'documents' && (
            <Suspense fallback={<div className="card p-10 text-center text-brand-muted">Loading workspace…</div>}>
              <DocumentsSection clientId={activeClientId ?? undefined} />
            </Suspense>
          )}
          {section === 'ideas' && <IdeasBoard />}
        </main>
      </div>
    </div>
    <BackgroundToasts />
    </BackgroundTasksProvider>
  );
}
