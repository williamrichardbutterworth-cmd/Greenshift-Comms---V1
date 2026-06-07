import { useState } from 'react';
import { Header, type Tab } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { DailyReview } from './components/DailyReview';
import { NewsFeed } from './components/NewsFeed';
import { ReportGenerator } from './components/ReportGenerator';
import { IdeasBoard } from './components/IdeasBoard';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="min-h-full">
      <Header tab={tab} onChange={setTab} />
      <main className="mx-auto max-w-6xl px-5 py-6">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'brief' && <DailyReview />}
        {tab === 'news' && <NewsFeed />}
        {tab === 'report' && <ReportGenerator />}
        {tab === 'ideas' && <IdeasBoard />}
      </main>
    </div>
  );
}
