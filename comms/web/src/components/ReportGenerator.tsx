import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Sparkles, Download, FileText, Trash2, FilePlus2, History, Save, FolderOpen, Pencil, RotateCcw,
  Paperclip, Loader2, ChevronDown, Building2, Library, PenLine, Link2, Plus, LayoutGrid, Search, Bookmark,
} from 'lucide-react';
import {
  api, EMPTY_DOC,
  type NewsItem, type ReportInputs, type MarketSnapshot, type ReportDoc, type ContextItem,
  type ReportProject, type ReportProjectSummary, type ReportVersion, type NewsRef, type ClientFile, type SavedArticle,
} from '../lib/api';
import { CommsEditor } from '../editor/CommsEditor';
import { PageOverview } from '../editor/PageOverview';
import { ClientProfileForm } from './ClientProfileForm';
import { CollapsibleSection } from './CollapsibleSection';
import { ReportHome } from './ReportHome';
import { buildDocFromSections } from '../lib/buildDocFromSections';

const FIELDS: { key: keyof ReportInputs; label: string; placeholder: string }[] = [
  { key: 'companyName', label: 'Company', placeholder: 'Acme Manufacturing Ltd' },
  { key: 'clientName', label: 'Contact name', placeholder: 'Jane Smith' },
  { key: 'contact', label: 'Contact detail', placeholder: 'jane@acme.co.uk' },
  { key: 'sites', label: 'Sites / meters', placeholder: '3 sites · 4 MPANs' },
  { key: 'currentSupplier', label: 'Current supplier', placeholder: 'British Gas' },
  { key: 'contractEnd', label: 'Contract end', placeholder: 'Sep 2026' },
  { key: 'consumption', label: 'Annual consumption', placeholder: '450,000 kWh' },
];

// Staged status shown while the draft is assembled (the API call is one shot;
// these keep the wait legible).
const DRAFT_STAGES = [
  'Gathering live market data…',
  'Weighing the client profile and your references…',
  'Composing the narrative sections…',
  'Building your document…',
];

const toRef = (n: NewsItem): NewsRef => ({ source: n.source, title: n.title, url: n.url });
const docHasMarketData = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type === 'metricsTable' || n.type === 'priceChart');
const docHasContent = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0);

export function ReportGenerator() {
  const [projects, setProjects] = useState<ReportProjectSummary[]>([]);
  const [current, setCurrent] = useState<ReportProject | null>(null);
  const [inputs, setInputs] = useState<ReportInputs>({});
  const [doc, setDoc] = useState<ReportDoc>(EMPTY_DOC);
  const [docKey, setDocKey] = useState('none');
  const editorRef = useRef<Editor | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const dirty = useRef(false);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [provider, setProvider] = useState('');

  const [ctxSnapshot, setCtxSnapshot] = useState(true);
  const [ctxBrief, setCtxBrief] = useState(false);
  const [ctxNotes, setCtxNotes] = useState('');

  const [drafting, setDrafting] = useState(false);
  const [draftStage, setDraftStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showVersions, setShowVersions] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refUrl, setRefUrl] = useState('');
  const [refQuery, setRefQuery] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);

  const refreshProjects = useCallback(() => api.projects.list().then(setProjects).catch(() => {}), []);

  // References = saved-article library + the live feed (deduped by title).
  const reloadEvidence = () => Promise.all([
    api.news(10).catch(() => [] as NewsItem[]),
    api.savedArticles.list().catch(() => [] as SavedArticle[]),
  ]).then(([liveItems, saved]) => {
    const fromLib: NewsItem[] = saved.map((a) => ({
      id: `lib-${a.id}`, title: a.title, source: a.source || 'Saved', url: a.url,
      publishedAt: a.publishedAt ?? '', summary: a.summary, topic: a.topic,
    }));
    const seen = new Set<string>();
    setNews([...fromLib, ...liveItems].filter((n) => {
      const k = n.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }));
  });

  useEffect(() => { refreshProjects(); reloadEvidence(); }, [refreshProjects]);

  // ── Context tray ⇄ report_projects.context ──
  const buildContext = useCallback((): ContextItem[] => {
    const items: ContextItem[] = [];
    if (ctxSnapshot) items.push({ id: 'market-snapshot', kind: 'marketSnapshot', label: 'Live market snapshot' });
    if (ctxBrief) items.push({ id: 'daily-brief', kind: 'dailyBrief', label: 'Today’s market brief' });
    if (ctxNotes.trim()) items.push({ id: 'extra-notes', kind: 'note', label: 'Extra context', note: ctxNotes });
    for (const n of news.filter((x) => selected.has(x.id))) {
      items.push({ id: `news-sel:${n.id}`, kind: 'news', label: n.title, news: [toRef(n)] });
    }
    return items;
  }, [ctxSnapshot, ctxBrief, ctxNotes, selected, news]);

  // Empty/missing context = legacy project or untouched tray → sensible defaults.
  const restoreContext = (items: ContextItem[] | undefined) => {
    const ctx = items ?? [];
    if (!ctx.length) { setCtxSnapshot(true); setCtxBrief(false); setCtxNotes(''); setSelected(new Set()); return; }
    setCtxSnapshot(ctx.some((c) => c.kind === 'marketSnapshot'));
    setCtxBrief(ctx.some((c) => c.kind === 'dailyBrief'));
    setCtxNotes(ctx.find((c) => c.kind === 'note' && c.id === 'extra-notes')?.note ?? '');
    setSelected(new Set(ctx.filter((c) => c.id.startsWith('news-sel:')).map((c) => c.id.slice('news-sel:'.length))));
  };

  // ── Debounced autosave (doc + inputs + context tray) ──
  useEffect(() => {
    if (!current || !dirty.current) return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        const saved = await api.projects.update(current.id, { doc, inputs, context: buildContext() });
        dirty.current = false;
        setSaveState('saved');
        setCurrent((c) => (c && c.id === saved.id ? saved : c));
        refreshProjects();
      } catch (e) {
        setErr(String((e as Error).message));
        setSaveState('idle');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, inputs, current, buildContext, refreshProjects]);

  const markDirty = () => { dirty.current = true; };
  const handleReady = useCallback((e: Editor) => { editorRef.current = e; setEditorInstance(e); }, []);
  const onDocChange = (d: ReportDoc) => { markDirty(); setDoc(d); };
  const setField = (k: keyof ReportInputs, v: string) => { markDirty(); setInputs((s) => ({ ...s, [k]: v })); };

  // ── Project lifecycle ──
  const resetTransient = () => { setSnapshot(null); setProvider(''); setShowVersions(false); setErr(null); setFiles([]); setRefQuery(''); };
  const loadFiles = (projectId: string) => api.files.list({ projectId }).then(setFiles).catch(() => setFiles([]));

  const onProfileDone = (p: ReportProject) => {
    dirty.current = false;
    setCreating(false);
    setCurrent(p); setInputs(p.inputs ?? {}); setDoc(p.doc ?? EMPTY_DOC); setDocKey(p.id);
    resetTransient(); restoreContext(p.context); loadFiles(p.id); refreshProjects();
  };
  const openProject = async (id: string) => {
    try {
      const p = await api.projects.get(id);
      dirty.current = false;
      setCurrent(p); setInputs(p.inputs ?? {}); setDoc(p.doc ?? EMPTY_DOC); setDocKey(p.id);
      resetTransient(); restoreContext(p.context); loadFiles(p.id);
    } catch (e) { setErr(String((e as Error).message)); }
  };
  // Back to the overview — flush any pending autosave first.
  const goHome = async () => {
    if (current && dirty.current) {
      try { await api.projects.update(current.id, { doc, inputs, context: buildContext() }); dirty.current = false; }
      catch { /* the overview still opens; the project keeps its last good save */ }
    }
    setCurrent(null); setDoc(EMPTY_DOC); setInputs({}); setDocKey('none');
    setSaveState('idle');
    refreshProjects();
  };
  const renameProject = async () => {
    if (!current) return;
    const name = window.prompt('Report name', current.name);
    if (!name) return;
    try { const saved = await api.projects.update(current.id, { name }); setCurrent(saved); refreshProjects(); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const deleteProject = async (id: string) => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    try {
      await api.projects.remove(id);
      if (current?.id === id) { setCurrent(null); setDoc(EMPTY_DOC); setInputs({}); setDocKey('none'); }
      refreshProjects();
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const saveVersion = async () => {
    if (!current) return;
    const label = window.prompt('Name this version (optional)', '') ?? '';
    try {
      const saved = await api.projects.update(current.id, { doc, inputs, context: buildContext(), saveVersion: true, versionLabel: label });
      dirty.current = false; setCurrent(saved); setSaveState('saved'); refreshProjects();
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const restoreVersion = (v: ReportVersion) => {
    markDirty();
    setInputs(v.inputs ?? {});
    if (editorRef.current) editorRef.current.commands.setContent(v.doc, true);
    else setDoc(v.doc);
    setShowVersions(false);
  };

  // ── References ──
  const toggle = (id: string) => {
    markDirty();
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectedNews = () => news.filter((n) => selected.has(n.id));

  const addRefUrl = async () => {
    if (!refUrl.trim()) return;
    setAddingUrl(true); setErr(null);
    try {
      const a = await api.savedArticles.fromUrl(refUrl.trim());
      setRefUrl('');
      await reloadEvidence();
      markDirty();
      setSelected((s) => new Set(s).add(`lib-${a.id}`));
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setAddingUrl(false); }
  };

  const insertArticle = (n: NewsItem, at?: number) => {
    const ed = editorRef.current; if (!ed) return;
    const pos = at ?? ed.state.doc.content.size;
    ed.chain().focus().insertContentAt(pos, { type: 'newsList', attrs: { items: [{ source: n.source, title: n.title, url: n.url }] } }).run();
  };
  const insertFile = (f: ClientFile, at?: number) => {
    const ed = editorRef.current; if (!ed) return;
    const pos = at ?? ed.state.doc.content.size;
    const href = api.files.downloadUrl(f.id);
    if (f.mime.startsWith('image/')) ed.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: href } }).run();
    else ed.chain().focus().insertContentAt(pos, { type: 'paragraph', content: [{ type: 'text', text: 'Reference: ' }, { type: 'text', marks: [{ type: 'link', attrs: { href } }], text: f.name }] }).run();
  };
  const dragRef = (kind: 'article' | 'file', id: string) => (e: DragEvent) => {
    e.dataTransfer.setData('application/x-comms-ref', JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  // pos comes from the editor's drop handler (posAtCoords) → insert at the cursor.
  const onDropReference = (payload: string, pos?: number) => {
    try {
      const { kind, id } = JSON.parse(payload) as { kind: string; id: string };
      if (kind === 'article') { const n = news.find((x) => x.id === id); if (n) insertArticle(n, pos); }
      else if (kind === 'file') { const f = files.find((x) => x.id === id); if (f) insertFile(f, pos); }
    } catch { /* ignore */ }
  };

  // ── Files & media ──
  const onUpload = async (fileList: FileList | null) => {
    if (!fileList || !current) return;
    setUploading(true); setErr(null);
    try {
      for (const file of Array.from(fileList)) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] ?? '';
        const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, projectId: current.id });
        setFiles((f) => [saved, ...f]);
        if (file.type.startsWith('image/')) editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
      }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setUploading(false); }
  };
  const removeUpload = async (id: string) => {
    try { await api.files.remove(id); setFiles((f) => f.filter((x) => x.id !== id)); }
    catch (e) { setErr(String((e as Error).message)); }
  };

  const assemble = async () => {
    if (!current) return;
    if (docHasContent(doc) && !window.confirm('Assembling a draft will replace the current document. Continue?')) return;
    setDrafting(true); setErr(null);
    let stageIdx = 0;
    setDraftStage(DRAFT_STAGES[0]);
    const stageTimer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, DRAFT_STAGES.length - 1);
      setDraftStage(DRAFT_STAGES[stageIdx]);
    }, 4500);
    try {
      let dailyBrief: string | null = null;
      if (ctxBrief) { try { dailyBrief = (await api.dailyReview()).review ?? null; } catch { /* ignore */ } }
      const sel = selectedNews();
      const fileNotes = files.filter((f) => f.extractedText.trim()).map((f) => `From “${f.name}”:\n${f.extractedText.slice(0, 3000)}`).join('\n\n');
      const res = await api.assembleReport(inputs, {
        selectedNews: sel.map((n) => ({ source: n.source, title: n.title, summary: n.summary })),
        includeSnapshot: ctxSnapshot,
        dailyBrief,
        extraNotes: [ctxNotes, fileNotes].filter(Boolean).join('\n\n'),
      });
      setSnapshot(res.snapshot); setProvider(res.provider);
      if (res.provider === 'error' && res.note) setErr(`Auto-drafting unavailable (${res.note.slice(0, 150)}). Built an editable skeleton you can fill in.`);
      const built = buildDocFromSections(res.sections, { snapshot: res.snapshot, selectedNews: sel.map(toRef) });
      markDirty();
      if (editorRef.current) editorRef.current.commands.setContent(built, true);
      else setDoc(built);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { clearInterval(stageTimer); setDraftStage(null); setDrafting(false); }
  };

  const download = async (fmt: 'pdf' | 'docx') => {
    const liveDoc = (editorRef.current?.getJSON() as ReportDoc | undefined) ?? doc;
    if (!liveDoc.content?.length) return;
    setExporting(fmt); setErr(null);
    try {
      let attributions = (snapshot?.sources ?? []).filter((s) => s.attribution).map((s) => s.attribution!);
      if (!attributions.length && docHasMarketData(liveDoc)) {
        try { const m = await api.market(); attributions = m.sources.filter((s) => s.attribution).map((s) => s.attribution!); } catch { /* ignore */ }
      }
      const meta = { asOf: snapshot?.asOf, attributions };
      const exp = await import('../lib/exportReport');
      const { blob, filename } = fmt === 'pdf' ? await exp.exportReportPdf(inputs, liveDoc, meta) : await exp.exportReportDocx(inputs, liveDoc, meta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setExporting(null); }
  };

  // ── Overview (no report open) ──
  if (!current) {
    return (
      <>
        {creating && <ClientProfileForm onDone={onProfileDone} onCancel={() => setCreating(false)} />}
        <ReportHome
          projects={projects}
          onOpen={openProject}
          onNew={() => setCreating(true)}
          onRefresh={refreshProjects}
        />
        {err && <p className="text-sm text-up mt-3 text-center">{err}</p>}
      </>
    );
  }

  const refQ = refQuery.trim().toLowerCase();
  const shownRefs = refQ ? news.filter((n) => n.title.toLowerCase().includes(refQ) || n.source.toLowerCase().includes(refQ)) : news;

  return (
    <>
      {creating && <ClientProfileForm onDone={onProfileDone} onCancel={() => setCreating(false)} />}

      {/* Top bar */}
      <div className="card px-3 py-2 flex flex-wrap items-center gap-2 sticky top-[57px] z-20 mb-3">
        <button className="btn-ghost !py-1.5 !px-2" onClick={goHome} title="All reports & clients">
          <LayoutGrid size={15} />
        </button>
        <div className="relative">
          <button className="btn-ghost !py-1.5" onClick={() => setShowOpen((v) => !v)}>
            <FolderOpen size={15} /> <span className="max-w-[180px] truncate">{current.name}</span> <ChevronDown size={13} />
          </button>
          {showOpen && (
            <div className="absolute left-0 mt-1 w-72 card p-1.5 z-30 max-h-80 overflow-auto" onMouseLeave={() => setShowOpen(false)}>
              <button className="btn-primary w-full !py-1.5 mb-1" onClick={() => { setShowOpen(false); setCreating(true); }}><FilePlus2 size={14} /> New report</button>
              {projects.map((p) => (
                <div key={p.id} className={'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm cursor-pointer ' + (current.id === p.id ? 'bg-brand-tint' : 'hover:bg-brand-surface')} onClick={() => { setShowOpen(false); openProject(p.id); }}>
                  <FolderOpen size={13} className="text-brand-muted shrink-0" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-up" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }} title="Delete"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={renameProject} title="Rename report" className="text-brand-muted hover:text-brand-ink"><Pencil size={13} /></button>
        <span className="text-xs text-brand-muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}</span>

        <div className="flex-1" />

        <div className="relative">
          <button className="btn-ghost !py-1.5" onClick={() => setShowVersions((v) => !v)} title="Version history">
            <History size={15} /> <span className="hidden sm:inline">Versions{current.versions.length ? ` (${current.versions.length})` : ''}</span>
          </button>
          {showVersions && (
            <div className="absolute right-0 mt-1 w-64 card p-1.5 z-30 max-h-64 overflow-auto" onMouseLeave={() => setShowVersions(false)}>
              {current.versions.length ? [...current.versions].reverse().map((v) => (
                <div key={v.at} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-brand-surface text-sm">
                  <div className="flex-1 min-w-0"><div className="truncate">{v.label}</div><div className="text-[11px] text-brand-muted">{new Date(v.at).toLocaleString('en-GB')}</div></div>
                  <button className="btn-ghost !px-1.5 !py-1" onClick={() => restoreVersion(v)} title="Restore"><RotateCcw size={13} /></button>
                </div>
              )) : <p className="text-xs text-brand-muted px-2 py-2">No saved versions yet.</p>}
            </div>
          )}
        </div>
        <button className="btn-ghost !py-1.5" onClick={saveVersion} title="Snapshot current state"><Save size={15} /> <span className="hidden md:inline">Save version</span></button>
        <button className="btn-primary !py-1.5" onClick={assemble} disabled={drafting}><Sparkles size={15} /> {drafting ? 'Assembling…' : 'Assemble'}</button>
        <div className="relative">
          <button className="btn-ghost !py-1.5" onClick={() => setShowExport((v) => !v)} disabled={!!exporting}>
            <Download size={15} /> {exporting ? 'Exporting…' : 'Export'} <ChevronDown size={13} />
          </button>
          {showExport && (
            <div className="absolute right-0 mt-1 w-36 card p-1 z-30" onMouseLeave={() => setShowExport(false)}>
              <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); download('pdf'); }}>Download PDF</button>
              <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); download('docx'); }}>Download Word</button>
            </div>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-up mb-2">{err}</p>}

      {/* 3-zone layout: overview · A4 page · setup */}
      <div className="grid grid-cols-1 xl:grid-cols-[170px_minmax(0,1fr)_380px] gap-6 items-start">
        <div className="hidden xl:block sticky top-[110px]"><PageOverview editor={editorInstance} /></div>

        <div className="min-w-0 relative">
          <CommsEditor docKey={docKey} initialDoc={doc} onChange={onDocChange} onReady={handleReady} onFiles={onUpload} onDropReference={onDropReference} />
          {drafting && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/70 backdrop-blur-[1.5px] rounded-xl">
              <div className="card px-7 py-5 text-center shadow-md max-w-xs">
                <Loader2 className="animate-spin mx-auto mb-2.5 text-brand-green" size={22} />
                <div className="text-sm font-medium min-h-[20px]">{draftStage}</div>
                <div className="text-[11px] text-brand-muted mt-1.5">Assembling your draft — this can take up to half a minute.</div>
              </div>
            </div>
          )}
          <p className="text-[11px] text-brand-muted mt-2">
            Auto-drafted — review and edit before sending. Prices are indicative, not a quotation; general market commentary, not financial advice.
          </p>
        </div>

        <div className="space-y-3">
          <CollapsibleSection title="Client profile" icon={Building2} defaultOpen={false}>
            <div className="space-y-2.5">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="label block mb-1">{f.label}</label>
                  <input className="input !py-1.5 text-sm" placeholder={f.placeholder} value={inputs[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="References &amp; media"
            icon={Library}
            defaultOpen
            right={<span className="text-[11px] text-brand-muted font-normal">{news.length} articles · {files.length} files</span>}
          >
            <div className="space-y-3">
              <div className="flex gap-1.5">
                <input className="input !py-1.5 text-sm flex-1" placeholder="Paste an article URL…" value={refUrl} onChange={(e) => setRefUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRefUrl(); }} />
                <button className="btn-ghost !py-1.5 !px-2" onClick={addRefUrl} disabled={addingUrl || !refUrl.trim()} title="Fetch & add to library">{addingUrl ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}</button>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="label flex-1">Articles — tick to use as context, ＋ to insert</div>
                </div>
                {news.length > 6 && (
                  <div className="relative mb-1.5">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
                    <input className="input !py-1 !pl-7 text-xs" placeholder="Filter articles…" value={refQuery} onChange={(e) => setRefQuery(e.target.value)} />
                  </div>
                )}
                <div className="space-y-0.5 max-h-40 overflow-auto pr-1">
                  {shownRefs.map((n) => (
                    <div key={n.id} draggable onDragStart={dragRef('article', n.id)} className="group flex items-start gap-1.5 text-xs py-0.5 cursor-grab">
                      <input type="checkbox" className="mt-0.5 accent-brand-green shrink-0" checked={selected.has(n.id)} onChange={() => toggle(n.id)} title="Use as context" />
                      {n.id.startsWith('lib-') && <Bookmark size={11} className="mt-0.5 text-brand-greenDark shrink-0" />}
                      <span className="flex-1 leading-snug"><span className="text-brand-greenDark">{n.source}:</span> {n.title}</span>
                      <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-brand-green shrink-0" onClick={() => insertArticle(n)} title="Insert into report"><Plus size={13} /></button>
                    </div>
                  ))}
                  {!shownRefs.length && <p className="text-xs text-brand-muted">{refQ ? 'No articles match.' : 'No articles yet — paste a URL or save from the News tab.'}</p>}
                </div>
              </div>

              <div>
                <div className="label mb-1">Files &amp; media</div>
                {files.length > 0 && (
                  <div className="space-y-0.5 max-h-36 overflow-auto pr-1 mb-2">
                    {files.map((f) => (
                      <div key={f.id} draggable onDragStart={dragRef('file', f.id)} className="group flex items-center gap-1.5 text-xs py-0.5 cursor-grab">
                        <FileText size={12} className="text-brand-muted shrink-0" />
                        <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                        {f.extractedText && <span className="text-[9px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0">ctx</span>}
                        <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-brand-green shrink-0" onClick={() => insertFile(f)} title="Insert into report"><Plus size={13} /></button>
                        <button className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-up shrink-0" onClick={() => removeUpload(f.id)} title="Remove"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="btn-ghost w-full cursor-pointer justify-center !py-1.5 text-sm">
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Upload file or image
                  <input type="file" multiple className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
                </label>
                <p className="text-[11px] text-brand-muted mt-1.5">PDFs/Word are mined for context; drag any item onto the page to insert it at the drop point, or drop files straight in.</p>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Your input" icon={PenLine} defaultOpen>
            <div className="space-y-2.5">
              <div>
                <label className="label block mb-1">Notes &amp; projections</label>
                <textarea className="input min-h-[70px] text-sm" placeholder="Your professional view — budget, risk appetite, renewal goals…" value={inputs.agentNotes ?? ''} onChange={(e) => setField('agentNotes', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-brand-green" checked={ctxSnapshot} onChange={(e) => { markDirty(); setCtxSnapshot(e.target.checked); }} /> Include live market snapshot
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="accent-brand-green" checked={ctxBrief} onChange={(e) => { markDirty(); setCtxBrief(e.target.checked); }} /> Include today’s market brief
              </label>
              <div>
                <label className="label block mb-1">Extra context for this draft</label>
                <textarea className="input min-h-[48px] text-sm" placeholder="Anything else to weave in…" value={ctxNotes} onChange={(e) => { markDirty(); setCtxNotes(e.target.value); }} />
              </div>
              <p className="text-[11px] text-brand-muted">These choices are saved with the report, so the tray is set up the same way next time you open it.</p>
            </div>
          </CollapsibleSection>

          <button className="btn-primary w-full" onClick={assemble} disabled={drafting}>
            <Sparkles size={16} /> {drafting ? 'Assembling…' : 'Assemble draft'}
          </button>
          {provider === 'none' && <p className="text-xs text-brand-muted">Automatic drafting isn’t set up — a structured skeleton is built that you can fill in.</p>}
        </div>
      </div>
    </>
  );
}
