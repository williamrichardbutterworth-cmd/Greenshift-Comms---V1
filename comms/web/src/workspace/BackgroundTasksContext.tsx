import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// A global background-task runner. `run(spec)` executes an async fn from the app
// ROOT (this provider never unmounts), so the work — and its result handling —
// survives navigating to any other client / tab / section. Components enqueue work
// and reflect a task's state instead of awaiting inline, so a long operation (a bill
// extraction, an upload+analyse, any automation) never blocks the UI. Completion is
// surfaced as a top-bar activity entry + a transient toast.

export type BgStatus = 'running' | 'done' | 'error';

export interface BgTask {
  id: string;
  kind: string; // 'bill' | 'analyse' | … — used to route "Open" + reflect per-section
  label: string;
  clientId?: string;
  clientName?: string;
  status: BgStatus;
  error?: string;
  result?: unknown;
  payload?: Record<string, unknown>; // context the opener needs (meter choice, file, …)
  startedAt: number;
  finishedAt?: number;
  seen?: boolean; // cleared count once the tray is opened
}

interface RunSpec<T> {
  kind: string;
  label: string;
  clientId?: string;
  clientName?: string;
  payload?: Record<string, unknown>;
  fn: () => Promise<T>;
}

interface BgValue {
  tasks: BgTask[];
  toasts: BgTask[];
  unseen: number;
  running: number;
  run: <T>(spec: RunSpec<T>) => string;
  dismiss: (id: string) => void;
  clearDone: () => void;
  markAllSeen: () => void;
  dismissToast: (id: string) => void;
  latestFor: (clientId: string, kind: string) => BgTask | undefined;
  open: (task: BgTask) => void;
}

const Ctx = createContext<BgValue | null>(null);

export function useBackgroundTasks(): BgValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useBackgroundTasks must be used within <BackgroundTasksProvider>');
  return c;
}

export function BackgroundTasksProvider({ children, onOpenTask }: { children: ReactNode; onOpenTask?: (task: BgTask) => void }) {
  const [tasks, setTasks] = useState<BgTask[]>([]);
  const [toasts, setToasts] = useState<BgTask[]>([]);
  const seq = useRef(0);

  const finish = useCallback((id: string, patch: Partial<BgTask>) => {
    setTasks((list) => {
      const done = list.map((t) => (t.id === id ? { ...t, ...patch, finishedAt: Date.now() } : t));
      const t = done.find((x) => x.id === id);
      if (t) setToasts((cur) => [t, ...cur.filter((x) => x.id !== id)]);
      return done;
    });
  }, []);

  const run = useCallback(<T,>(spec: RunSpec<T>): string => {
    const id = `bg-${++seq.current}-${Date.now()}`;
    const { fn, ...meta } = spec;
    const task: BgTask = { id, status: 'running', startedAt: Date.now(), ...meta };
    setTasks((list) => [task, ...list]);
    // Run on the microtask queue so a throw inside fn() before its first await is caught too.
    Promise.resolve()
      .then(fn)
      .then(
        (result) => finish(id, { status: 'done', result }),
        (err) => finish(id, { status: 'error', error: String((err as Error)?.message ?? err) }),
      );
    return id;
  }, [finish]);

  const dismiss = useCallback((id: string) => {
    setTasks((list) => list.filter((t) => t.id !== id));
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);
  const clearDone = useCallback(() => setTasks((list) => list.filter((t) => t.status === 'running')), []);
  const markAllSeen = useCallback(() => setTasks((list) => list.map((t) => (t.seen ? t : { ...t, seen: true }))), []);
  const dismissToast = useCallback((id: string) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);
  const latestFor = useCallback((clientId: string, kind: string) => tasks.find((t) => t.clientId === clientId && t.kind === kind), [tasks]);
  const open = useCallback((task: BgTask) => onOpenTask?.(task), [onOpenTask]);

  const unseen = tasks.filter((t) => t.status !== 'running' && !t.seen).length;
  const running = tasks.filter((t) => t.status === 'running').length;

  const value: BgValue = { tasks, toasts, unseen, running, run, dismiss, clearDone, markAllSeen, dismissToast, latestFor, open };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
