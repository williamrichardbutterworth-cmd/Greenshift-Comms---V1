import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api } from '../lib/api';
import { usePersisted } from '../lib/usePersisted';

// The universal client-tab workspace. A permanent "Free" tab (no client context —
// every section behaves free-form, the old behaviour) plus any number of open
// CLIENT tabs. When a client tab is active, every section (Clients / Emails / Bill
// Analysis / LOA / RFQ / Reports) scopes to that one client, so the broker works a
// whole client across the pipeline without re-selecting them in each section.
// Open tabs + the active tab persist across reloads (names are re-synced on mount).

export interface OpenClient { id: string; name: string }
export type ActiveTab = { kind: 'free' } | { kind: 'client'; id: string };

interface ClientTabsValue {
  openClients: OpenClient[];
  active: ActiveTab;
  activeClientId: string | null; // null when the Free tab is active
  openClient: (id: string, name?: string) => void; // add (if new) + activate
  closeClient: (id: string) => void;
  goFree: () => void;
  setActiveClient: (id: string) => void;
}

const Ctx = createContext<ClientTabsValue | null>(null);

export function useClientTabs(): ClientTabsValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useClientTabs must be used within <ClientTabsProvider>');
  return c;
}

export function ClientTabsProvider({ children }: { children: ReactNode }) {
  const [rawOpen, setOpenClients] = usePersisted<OpenClient[]>('comms.ui.clientTabs', []);
  const [rawActive, setActive] = usePersisted<ActiveTab>('comms.ui.activeTab', { kind: 'free' });

  // Defensive normalization — persisted localStorage can hold an old/foreign/corrupt
  // shape (a non-array, an entry with no id/name, an active of a bogus kind). Coerce
  // to safe values so a malformed atom can never crash the synchronous render.
  const openClients = useMemo<OpenClient[]>(
    () => (Array.isArray(rawOpen)
      ? rawOpen.filter((c): c is OpenClient => !!c && typeof c.id === 'string').map((c) => ({ id: c.id, name: typeof c.name === 'string' && c.name ? c.name : 'Client' }))
      : []),
    [rawOpen],
  );
  // openClients is the SINGLE SOURCE OF TRUTH: an active client that isn't an open tab
  // (stale persistence, a failed reconcile, a hand-edit) falls back to Free — so we
  // never mount a hub against a ghost id or show the bar with nothing selected.
  const active: ActiveTab = rawActive && rawActive.kind === 'client' && typeof rawActive.id === 'string' && openClients.some((c) => c.id === rawActive.id)
    ? { kind: 'client', id: rawActive.id }
    : { kind: 'free' };
  const activeClientId = active.kind === 'client' ? active.id : null;

  // On mount, reconcile persisted tabs with reality: refresh names, drop any client
  // that no longer exists, and fall back to Free if the active client was deleted.
  useEffect(() => {
    let cancelled = false;
    api.profiles.list().then((list) => {
      if (cancelled) return;
      const byId = new Map(list.map((c) => [c.id, c.name] as const));
      setOpenClients((prev) => (Array.isArray(prev) ? prev : []).filter((c) => c && byId.has(c.id)).map((c) => ({ id: c.id, name: byId.get(c.id) || c.name })));
      setActive((a) => (a && a.kind === 'client' && !byId.has(a.id) ? { kind: 'free' } : a));
    }).catch((e) => { if (!cancelled) console.warn('ClientTabs reconcile failed; keeping persisted tabs', e); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openClient = useCallback((id: string, name?: string) => {
    setOpenClients((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.some((c) => c.id === id)
        ? (name ? list.map((c) => (c.id === id ? { id, name } : c)) : list)
        : [...list, { id, name: name || 'Client' }];
    });
    setActive({ kind: 'client', id });
  }, [setOpenClients, setActive]);

  const setActiveClient = useCallback((id: string) => setActive({ kind: 'client', id }), [setActive]);
  const goFree = useCallback(() => setActive({ kind: 'free' }), [setActive]);

  // Both updaters stay PURE — the next-active value is computed from the current
  // openClients snapshot, not dispatched from inside the setOpenClients updater
  // (which StrictMode double-invokes).
  const closeClient = useCallback((id: string) => {
    setOpenClients((prev) => (Array.isArray(prev) ? prev : []).filter((c) => c.id !== id));
    setActive((a) => {
      if (a.kind !== 'client' || a.id !== id) return a;
      const idx = openClients.findIndex((c) => c.id === id);
      const next = openClients.filter((c) => c.id !== id);
      if (!next.length) return { kind: 'free' };
      return { kind: 'client', id: next[Math.min(idx, next.length - 1)].id };
    });
  }, [setOpenClients, setActive, openClients]);

  const value: ClientTabsValue = { openClients, active, activeClientId, openClient, closeClient, goFree, setActiveClient };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
