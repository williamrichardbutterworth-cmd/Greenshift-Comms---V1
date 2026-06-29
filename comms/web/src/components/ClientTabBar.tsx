import { Layers, X, Building2 } from 'lucide-react';
import { useClientTabs } from '../workspace/ClientTabsContext';

// The universal client-tab strip in the top bar: a permanent "Free" tab plus one
// tab per open client. The active tab decides whether the sections show free-form
// (Free) or scope to a single client.
export function ClientTabBar() {
  const { openClients, active, closeClient, goFree, setActiveClient } = useClientTabs();

  const base = 'group flex items-center gap-1.5 h-8 rounded-lg text-sm font-medium whitespace-nowrap transition shrink-0';
  const on = 'bg-brand-tint text-brand-greenDark';
  const off = 'text-brand-muted hover:text-brand-ink hover:bg-brand-surface';

  return (
    <div className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar">
      <button
        onClick={goFree}
        aria-pressed={active.kind === 'free'}
        title="Free workspace — navigate anything without locking to a client"
        className={`${base} px-3 ${active.kind === 'free' ? on : off}`}
      >
        <Layers size={14} className="shrink-0" />
        <span>Free</span>
      </button>

      {openClients.length > 0 && <span className="h-5 w-px bg-brand-line shrink-0 mx-0.5" aria-hidden="true" />}

      {openClients.map((c) => {
        const active_ = active.kind === 'client' && active.id === c.id;
        return (
          <div key={c.id} className={`${base} pl-2.5 pr-1 max-w-[200px] ${active_ ? on : off}`}>
            <button onClick={() => setActiveClient(c.id)} className="flex items-center gap-1.5 min-w-0" title={c.name}>
              <Building2 size={13} className="shrink-0 opacity-70" />
              <span className="truncate">{c.name}</span>
            </button>
            <button
              onClick={() => closeClient(c.id)}
              title={`Close ${c.name}`}
              aria-label={`Close ${c.name}`}
              className="grid place-items-center h-5 w-5 rounded shrink-0 text-brand-muted hover:text-up hover:bg-white/70 transition"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
