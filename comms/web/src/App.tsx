import { lazy, Suspense } from 'react';
import { Sidebar, SECTION_LABEL, type Tab } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { IdeasBoard } from './components/IdeasBoard';
import { usePersisted } from './lib/usePersisted';

// The report editor pulls in TipTap + the chart libraries, so load it only when
// the Clients section is opened (keeps the other sections lightweight).
const ReportGenerator = lazy(() =>
  import('./components/ReportGenerator').then((m) => ({ default: m.ReportGenerator })),
);

export default function App() {
  const [section, setSection] = usePersisted<Tab>('comms.ui.section', 'dashboard');
  const [collapsed, setCollapsed] = usePersisted<boolean>('comms.ui.sidebarCollapsed', false);

  // The Clients section hosts the full-bleed report studio → let it use the
  // whole content width; reading surfaces stay capped + centred for legibility.
  const wide = section === 'report';

  return (
    <div className="flex min-h-full">
      <Sidebar section={section} onChange={setSection} collapsed={collapsed} onToggleCollapse={() => setCollapsed((v) => !v)} />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Slim top bar — section context now; will host the open-document tab strip later. */}
        <div className="h-[var(--topbar-h)] shrink-0 sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-brand-line flex items-center px-5 lg:px-8">
          <span className="text-sm font-semibold">{SECTION_LABEL[section]}</span>
        </div>

        <main className={'flex-1 w-full px-5 lg:px-8 py-6 ' + (wide ? 'max-w-wide mx-auto 3xl:px-10' : 'max-w-content mx-auto')}>
          {section === 'dashboard' && <Dashboard />}
          {section === 'brief' && <DailyReview />}
          {section === 'news' && <NewsFeed />}
          {section === 'report' && (
            <Suspense fallback={<div className="card p-10 text-center text-brand-muted">Loading editor…</div>}>
              <ReportGenerator />
            </Suspense>
          )}
          {section === 'ideas' && <IdeasBoard />}
        </main>
      </div>
    </div>
  );
}
