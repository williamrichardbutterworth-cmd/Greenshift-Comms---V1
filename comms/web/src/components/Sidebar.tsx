import { LayoutDashboard, Newspaper, Users, Sparkles, Lightbulb, FileText, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

// Section ids are STABLE (referenced widely as `tab`); only labels/icons change.
export type Tab = 'dashboard' | 'brief' | 'news' | 'report' | 'documents' | 'ideas';

export const NAV: { id: Tab; label: string; icon: typeof LayoutDashboard; group?: 'intel' | 'work' }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'intel' },
  { id: 'brief', label: 'Daily Brief', icon: Sparkles, group: 'intel' },
  { id: 'news', label: 'News', icon: Newspaper, group: 'intel' },
  { id: 'report', label: 'Clients', icon: Users, group: 'work' },
  { id: 'documents', label: 'Documents', icon: FileText, group: 'work' },
  { id: 'ideas', label: 'Admin Ideas', icon: Lightbulb, group: 'work' },
];

export const SECTION_LABEL: Record<Tab, string> = Object.fromEntries(NAV.map((n) => [n.id, n.label])) as Record<Tab, string>;

const GROUP_LABEL: Record<NonNullable<(typeof NAV)[number]['group']>, string> = {
  intel: 'Market intelligence',
  work: 'Client work',
};

export function Sidebar({
  section, onChange, collapsed, onToggleCollapse, docCount = 0,
}: {
  section: Tab;
  onChange: (t: Tab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  docCount?: number;
}) {
  let lastGroup: string | undefined;
  return (
    <aside
      className={
        'shrink-0 sticky top-0 h-screen bg-white border-r border-brand-line flex flex-col transition-[width] duration-200 z-40 ' +
        (collapsed ? 'w-[var(--sidebar-w-collapsed)]' : 'w-[var(--sidebar-w)]')
      }
    >
      {/* Brand */}
      <div className="h-[var(--topbar-h)] shrink-0 flex items-center gap-2.5 px-3 border-b border-brand-line">
        <img src="/gse.png" alt="Green Shift Energy" className="h-7 w-7 object-contain shrink-0" />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold truncate">Green Shift</div>
            <div className="text-[10px] uppercase tracking-wide text-brand-muted truncate">Comms</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          const groupChanged = item.group && item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <div key={item.id}>
              {!collapsed && groupChanged && (
                <div className="px-2 pt-3 pb-1 text-[10px] uppercase tracking-wide text-brand-muted/80 first:pt-1">
                  {GROUP_LABEL[item.group!]}
                </div>
              )}
              {collapsed && groupChanged && lastGroup !== NAV[0].group && <div className="my-1.5 mx-2 border-t border-brand-line" />}
              <button
                onClick={() => onChange(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={
                  'relative w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ' +
                  (collapsed ? 'justify-center ' : '') +
                  (active
                    ? 'bg-brand-tint text-brand-greenDark'
                    : 'text-brand-muted hover:text-brand-ink hover:bg-brand-surface')
                }
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                {item.id === 'documents' && docCount > 0 && (
                  <span
                    className={
                      'text-[10px] font-semibold rounded-full bg-brand-green/15 text-brand-greenDark min-w-[18px] text-center ' +
                      (collapsed ? 'absolute top-1 right-1 px-1 leading-4' : 'px-1.5 py-0.5')
                    }
                  >
                    {docCount}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="shrink-0 p-2 border-t border-brand-line">
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={
            'w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-brand-muted hover:text-brand-ink hover:bg-brand-surface transition ' +
            (collapsed ? 'justify-center' : '')
          }
        >
          {collapsed ? <PanelLeftOpen size={18} className="shrink-0" /> : <PanelLeftClose size={18} className="shrink-0" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
