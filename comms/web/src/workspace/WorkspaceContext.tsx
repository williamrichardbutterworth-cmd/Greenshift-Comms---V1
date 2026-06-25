import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type ReportProject } from '../lib/api';
import { NewDocumentFlow, type NewDocRequest } from '../components/NewDocumentFlow';

// One open document = one session. The session caches the project (with its latest
// doc/inputs/context) so switching tabs re-seeds the studio without a refetch and
// without losing edits (the studio flushes into the session on unmount).
export interface DocSession { id: string; project: ReportProject }

interface WorkspaceValue {
  order: string[];
  activeId: string | null;
  sessions: Record<string, DocSession>;
  count: number;
  openDoc: (project: ReportProject) => void;
  openDocById: (id: string) => Promise<void>;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  updateProject: (project: ReportProject) => void;
  requestNewDoc: (req: NewDocRequest) => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspace must be used within <WorkspaceProvider>');
  return c;
}

export function WorkspaceProvider({ children, onNavigateToDocuments }: {
  children: ReactNode;
  onNavigateToDocuments: () => void;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, DocSession>>({});
  const [newReq, setNewReq] = useState<NewDocRequest | null>(null);

  // Synchronous read of the open-doc list for openDocById (avoids stale closures).
  const orderRef = useRef<string[]>([]);
  useEffect(() => { orderRef.current = order; }, [order]);

  const openDoc = useCallback((project: ReportProject) => {
    setSessions((s) => ({ ...s, [project.id]: { id: project.id, project } }));
    setOrder((o) => (o.includes(project.id) ? o : [...o, project.id]));
    setActiveId(project.id);
    onNavigateToDocuments();
  }, [onNavigateToDocuments]);

  const setActive = useCallback((id: string) => { setActiveId(id); onNavigateToDocuments(); }, [onNavigateToDocuments]);

  const openDocById = useCallback(async (id: string) => {
    if (orderRef.current.includes(id)) { setActive(id); return; }
    try { openDoc(await api.projects.get(id)); }
    catch { /* a missing/deleted project simply doesn't open */ }
  }, [openDoc, setActive]);

  // Refresh a session's cached project (called by the studio after save / on flush)
  // — only if still open, so a closed doc isn't resurrected by a late save.
  const updateProject = useCallback((project: ReportProject) => {
    setSessions((s) => (s[project.id] ? { ...s, [project.id]: { id: project.id, project } } : s));
  }, []);

  const closeDoc = useCallback((id: string) => {
    setOrder((o) => {
      const idx = o.indexOf(id);
      const next = o.filter((x) => x !== id);
      setActiveId((cur) => (cur !== id ? cur : next.length ? next[Math.min(idx, next.length - 1)] : null));
      return next;
    });
    setSessions((s) => { const n = { ...s }; delete n[id]; return n; });
  }, []);

  const requestNewDoc = useCallback((req: NewDocRequest) => setNewReq({ ...req }), []);

  const value: WorkspaceValue = {
    order, activeId, sessions, count: order.length,
    openDoc, openDocById, closeDoc, setActive, updateProject, requestNewDoc,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <NewDocumentFlow request={newReq} onCreated={(p) => { setNewReq(null); openDoc(p); }} onCancel={() => setNewReq(null)} />
    </Ctx.Provider>
  );
}
