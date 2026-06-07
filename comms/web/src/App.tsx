import { lazy, Suspense, useState } from 'react';
import { Header, type Tab } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { IdeasBoard } from './components/IdeasBoard';

// The report editor pulls in TipTap + the chart libraries, so load it only when
// the Report tab is opened (keeps the other tabs lightweight).
const ReportGenerator = lazy(() =>
  import('./components/ReportGenerator').then((m) => ({ default: m.ReportGenerator })),
);

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="min-h-full">
      <Header tab={tab} onChange={setTab} />
      <main className="mx-auto max-w-6xl px-5 py-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'brief' && <DailyReview />}
        {tab === 'news' && <NewsFeed />}
        {tab === 'report' && (
          <Suspense fallback={<div className="card p-10 text-center text-brand-muted">Loading editor…</div>}>
            <ReportGenerator />
          </Suspense>
        )}
        {tab === 'ideas' && <IdeasBoard />}
      </main>
    </div>
  );
}
