import { LayoutDashboard, Newspaper, FileText, Sparkles, Lightbulb } from 'lucide-react';

export type Tab = 'dashboard' | 'brief' | 'news' | 'report' | 'ideas';

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'brief', label: 'Daily Brief', icon: Sparkles },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'ideas', label: 'Admin Ideas', icon: Lightbulb },
];

export function Header({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-brand-line">
      <div className="mx-auto max-w-6xl px-5">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <img src="/gse.png" alt="Green Shift Energy" className="h-8 w-auto" />
            <span className="hidden sm:inline text-brand-muted text-sm border-l border-brand-line pl-3">
              Comms · Market Intelligence
            </span>
          </div>
        </div>
        <nav className="flex gap-1 -mb-px">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                className={
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition ' +
                  (active
                    ? 'border-brand-green text-brand-ink'
                    : 'border-transparent text-brand-muted hover:text-brand-ink')
                }
              >
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
