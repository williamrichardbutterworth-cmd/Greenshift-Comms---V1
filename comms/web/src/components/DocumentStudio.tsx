import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Sparkles, Download, FileText, Trash2, History, Save, Pencil, RotateCcw,
  Paperclip, Loader2, ChevronDown, Building2, Library, PenLine, Link2, Plus, Search, Bookmark, Copy,
  MessagesSquare, Phone, Mail, StickyNote,
} from 'lucide-react';
import {
  api, EMPTY_DOC,
  type NewsItem, type ReportInputs, type MarketSnapshot, type ReportDoc, type ContextItem,
  type ReportProject, type ReportVersion, type NewsRef, type ClientFile, type SavedArticle, type DocNode, type NewActivity,
  type ClientActivity, type ActivityType,
} from '../lib/api';
import { relativeTime } from '../lib/crm';
import { CommsEditor } from '../editor/CommsEditor';
import { PageOverview } from '../editor/PageOverview';
import { CollapsibleSection } from './CollapsibleSection';
import { buildDocFromSections } from '../lib/buildDocFromSections';

const FIELDS: Record<string, { label: string; placeholder: string }> = {
  companyName: { label: 'Company', placeholder: 'Acme Manufacturing Ltd' },
  clientName: { label: 'Contact name', placeholder: 'Jane Smith' },
  contact: { label: 'Contact detail', placeholder: 'jane@acme.co.uk' },
  sites: { label: 'Sites / meters', placeholder: '3 sites · 4 MPANs' },
  currentSupplier: { label: 'Current supplier', placeholder: 'British Gas' },
  contractEnd: { label: 'Contract end', placeholder: 'Sep 2026' },
  consumption: { label: 'Annual consumption', placeholder: '450,000 kWh' },
};
// Grouped so the client panel reads as a structured record, not a flat field stack.
const FIELD_GROUPS: { label: string; keys: (keyof ReportInputs)[] }[] = [
  { label: 'Identity', keys: ['companyName', 'clientName', 'contact'] },
  { label: 'Contract', keys: ['currentSupplier', 'contractEnd', 'sites'] },
  { label: 'Consumption', keys: ['consumption'] },
];

const DRAFT_STAGES = [
  'Gathering live market data…',
  'Weighing the client profile and your references…',
  'Composing the narrative sections…',
  'Building your document…',
];

const CONVO_TYPES = new Set<ActivityType>(['transcript', 'note', 'email-sent', 'email-received', 'recommendation']);
const CONVO_ICON: Partial<Record<ActivityType, typeof MessagesSquare>> = {
  transcript: Phone, 'email-sent': Mail, 'email-received': Mail, note: StickyNote, recommendation: Sparkles,
};
const stringAngles = (meta: Record<string, unknown> | undefined): string[] | undefined =>
  Array.isArray(meta?.angles) ? (meta!.angles as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;

const toRef = (n: NewsItem): NewsRef => ({ source: n.source, title: n.title, url: n.url });
const docHasMarketData = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type === 'metricsTable' || n.type === 'priceChart');
const docHasContent = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0);

// Tray state ⇄ report_projects.context (kept stable so saved trays don't reset).
interface TrayInit { ctxSnapshot: boolean; ctxBrief: boolean; ctxNotes: string; selected: Set<string>; selectedConvos: Set<string> }
function parseContext(items?: ContextItem[]): TrayInit {
  const ctx = items ?? [];
  if (!ctx.length) return { ctxSnapshot: true, ctxBrief: false, ctxNotes: '', selected: new Set(), selectedConvos: new Set() };
  return {
    ctxSnapshot: ctx.some((c) => c.kind === 'marketSnapshot'),
    ctxBrief: ctx.some((c) => c.kind === 'dailyBrief'),
    ctxNotes: ctx.find((c) => c.kind === 'note' && c.id === 'extra-notes')?.note ?? '',
    selected: new Set(ctx.filter((c) => c.id.startsWith('news-sel:')).map((c) => c.id.slice('news-sel:'.length))),
    selectedConvos: new Set(ctx.filter((c) => c.id.startsWith('convo-sel:')).map((c) => c.id.slice('convo-sel:'.length))),
  };
}

// One open document's editor + setup tray. Mounted per active tab (keyed by project
// id), so all state is seeded from `project` at mount; edits autosave and flush into
// the workspace session on unmount so background tabs keep their changes.
export function DocumentStudio({ project, onProjectSaved }: {
  project: ReportProject;
  onProjectSaved: (p: ReportProject) => void;
}) {
  const init = useRef(parseContext(project.context)).current;

  const [proj, setProj] = useState<ReportProject>(project);
  const [inputs, setInputs] = useState<ReportInputs>(project.inputs ?? {});
  const [doc, setDoc] = useState<ReportDoc>(project.doc ?? EMPTY_DOC);
  const editorRef = useRef<Editor | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const dirty = useRef(false);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(init.selected);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [provider, setProvider] = useState('');

  const [ctxSnapshot, setCtxSnapshot] = useState(init.ctxSnapshot);
  const [ctxBrief, setCtxBrief] = useState(init.ctxBrief);
  const [ctxNotes, setCtxNotes] = useState(init.ctxNotes);
  const [convos, setConvos] = useState<ClientActivity[]>([]);
  const [selectedConvos, setSelectedConvos] = useState<Set<string>>(init.selectedConvos);

  const [drafting, setDrafting] = useState(false);
  const [draftStage, setDraftStage] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [files, setFiles] = useState<ClientFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refUrl, setRefUrl] = useState('');
  const [refQuery, setRefQuery] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [refTab, setRefTab] = useState<'articles' | 'files'>('articles');

  // References = saved-article library + the live feed (deduped by title).
  const reloadEvidence = useCallback(() => Promise.all([
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
  }), []);

  // Load the linked client's conversational timeline + this project's + client's files.
  useEffect(() => {
    reloadEvidence();
    const cid = (project.inputs as ReportInputs | undefined)?.clientProfileId;
    Promise.all([
      api.files.list({ projectId: project.id }).catch(() => [] as ClientFile[]),
      cid ? api.files.list({ clientProfileId: cid }).catch(() => [] as ClientFile[]) : Promise.resolve([] as ClientFile[]),
    ]).then(([pf, cf]) => {
      const seen = new Set<string>();
      setFiles([...pf, ...cf].filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true))));
    }).catch(() => setFiles([]));
    if (cid) api.profiles.get(cid).then((p) => setConvos(p.activities.filter((a) => CONVO_TYPES.has(a.type)))).catch(() => setConvos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // ── Context tray ⇄ report_projects.context ──
  const buildContext = useCallback((): ContextItem[] => {
    const items: ContextItem[] = [];
    if (ctxSnapshot) items.push({ id: 'market-snapshot', kind: 'marketSnapshot', label: 'Live market snapshot' });
    if (ctxBrief) items.push({ id: 'daily-brief', kind: 'dailyBrief', label: 'Today’s market brief' });
    if (ctxNotes.trim()) items.push({ id: 'extra-notes', kind: 'note', label: 'Extra context', note: ctxNotes });
    for (const n of news.filter((x) => selected.has(x.id))) items.push({ id: `news-sel:${n.id}`, kind: 'news', label: n.title, news: [toRef(n)] });
    for (const c of convos.filter((x) => selectedConvos.has(x.id))) items.push({ id: `convo-sel:${c.id}`, kind: 'conversation', label: c.title });
    return items;
  }, [ctxSnapshot, ctxBrief, ctxNotes, selected, news, convos, selectedConvos]);

  const markDirty = () => { dirty.current = true; };
  const handleReady = useCallback((e: Editor) => { editorRef.current = e; setEditorInstance(e); }, []);
  const onDocChange = (d: ReportDoc) => { markDirty(); setDoc(d); };
  const setField = (k: keyof ReportInputs, v: string) => { markDirty(); setInputs((s) => ({ ...s, [k]: v })); };

  // ── Debounced autosave (doc + inputs + context tray) → session + list ──
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        const saved = await api.projects.update(proj.id, { doc, inputs, context: buildContext() });
        dirty.current = false;
        setSaveState('saved');
        setProj(saved);
        onProjectSaved(saved);
      } catch (e) {
        setErr(String((e as Error).message));
        setSaveState('idle');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, inputs, proj.id, buildContext, onProjectSaved]);

  // ── Flush unsaved edits when this tab unmounts (switch away / close) ──
  // Refs hold the freshest values for the mount-only cleanup.
  const flushRef = useRef<{ inputs: ReportInputs; buildContext: () => ContextItem[]; proj: ReportProject; onSaved: typeof onProjectSaved }>(
    { inputs, buildContext, proj, onSaved: onProjectSaved },
  );
  flushRef.current = { inputs, buildContext, proj, onSaved: onProjectSaved };
  useEffect(() => () => {
    if (!dirty.current) return;
    const { inputs: i, buildContext: bc, proj: p, onSaved } = flushRef.current;
    const liveDoc = (editorRef.current?.getJSON() as ReportDoc | undefined) ?? p.doc ?? EMPTY_DOC;
    const context = bc();
    onSaved({ ...p, doc: liveDoc, inputs: i, context }); // optimistic session update so re-open keeps edits
    api.projects.update(p.id, { doc: liveDoc, inputs: i, context }).catch(() => { /* best-effort */ });
  }, []);

  // ── References ──
  const toggle = (id: string) => { markDirty(); setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const selectedNews = () => news.filter((n) => selected.has(n.id));
  const toggleConvo = (id: string) => { markDirty(); setSelectedConvos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

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
  const onDropReference = (payload: string, pos?: number) => {
    try {
      const { kind, id } = JSON.parse(payload) as { kind: string; id: string };
      if (kind === 'article') { const n = news.find((x) => x.id === id); if (n) insertArticle(n, pos); }
      else if (kind === 'file') { const f = files.find((x) => x.id === id); if (f) insertFile(f, pos); }
    } catch { /* ignore */ }
  };

  // ── Files & media ──
  const onUpload = async (fileList: FileList | null) => {
    if (!fileList) return;
    setUploading(true); setErr(null);
    try {
      for (const file of Array.from(fileList)) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] ?? '';
        const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, projectId: proj.id });
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
    if (docHasContent(doc) && !window.confirm('Assembling a draft will replace the current document. Continue?')) return;
    setDrafting(true); setErr(null);
    let stageIdx = 0;
    setDraftStage(DRAFT_STAGES[0]);
    const stageTimer = setInterval(() => { stageIdx = Math.min(stageIdx + 1, DRAFT_STAGES.length - 1); setDraftStage(DRAFT_STAGES[stageIdx]); }, 4500);
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
        templateId: inputs.documentTypeId,
        linkedConversations: convos.filter((c) => selectedConvos.has(c.id)).map((c) => ({
          when: c.at, summary: c.title,
          points: c.detail ? [c.detail.slice(0, 1500)] : undefined,
          angles: stringAngles(c.meta),
        })),
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

  const renameProject = async () => {
    const name = window.prompt('Report name', proj.name);
    if (!name) return;
    try { const saved = await api.projects.update(proj.id, { name }); setProj(saved); onProjectSaved(saved); }
    catch (e) { setErr(String((e as Error).message)); }
  };
  const saveVersion = async () => {
    const label = window.prompt('Name this version (optional)', '') ?? '';
    try {
      const saved = await api.projects.update(proj.id, { doc, inputs, context: buildContext(), saveVersion: true, versionLabel: label });
      dirty.current = false; setProj(saved); setSaveState('saved'); onProjectSaved(saved);
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const restoreVersion = (v: ReportVersion) => {
    markDirty();
    setInputs(v.inputs ?? {});
    if (editorRef.current) editorRef.current.commands.setContent(v.doc, true);
    else setDoc(v.doc);
    setShowVersions(false);
  };

  const download = async (fmt: 'pdf' | 'docx') => {
    const liveDoc = (editorRef.current?.getJSON() as ReportDoc | undefined) ?? doc;
    if (!liveDoc.content?.length) return;
    setExporting(fmt); setErr(null);
    try {
      const attributions = (snapshot?.sources ?? []).filter((s) => s.attribution).map((s) => s.attribution!);
      if (!attributions.length && docHasMarketData(liveDoc)) {
        try { const m = await api.market(); attributions.push(...m.sources.filter((s) => s.attribution).map((s) => s.attribution!)); } catch { /* ignore */ }
      }
      for (const n of liveDoc.content ?? []) {
        if (n.type === 'gridMap') {
          const sources = (n.attrs as { snapshot?: { sources?: { attribution?: string }[] } } | undefined)?.snapshot?.sources ?? [];
          for (const s of sources) if (s.attribution && !attributions.includes(s.attribution)) attributions.push(s.attribution);
        }
      }
      const meta = { asOf: snapshot?.asOf, attributions, reportTitle: inputs.documentTypeName, reportSubtitle: inputs.documentSubtitle, reportKind: inputs.reportKind };
      const exp = await import('../lib/exportReport');
      const { blob, filename } = fmt === 'pdf' ? await exp.exportReportPdf(inputs, liveDoc, meta) : await exp.exportReportDocx(inputs, liveDoc, meta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      logClientActivity({ type: 'document', title: `Exported ${fmt.toUpperCase()}: ${proj.name}` });
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setExporting(null); }
  };

  const logClientActivity = (a: NewActivity) => {
    const cid = inputs.clientProfileId;
    if (cid) api.profiles.addActivity(cid, a).catch(() => { /* best-effort */ });
  };

  // ── Email channel: plain-text body from the live doc ──
  const EMBED_LABEL: Record<string, string> = {
    metricsTable: '[Market data table]', priceChart: '[Price chart]', customChart: '[Chart]',
    gridMap: '[Generation map]', newsList: '[Supporting evidence]', kpiStrip: '[Headline figures]',
    comparisonTable: '[Quote comparison]', forwardCurve: '[Procurement timing]',
  };
  const nodeText = (n: DocNode): string =>
    n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(nodeText).join('');
  const emailText = (): string => {
    const live = (editorRef.current?.getJSON() as ReportDoc | undefined) ?? doc;
    return (live.content ?? [])
      .map((n) => {
        if (n.type === 'bulletList') return (n.content ?? []).map((li) => '- ' + nodeText(li).trim()).join('\n');
        if (n.type === 'orderedList') return (n.content ?? []).map((li, i) => `${i + 1}. ${nodeText(li).trim()}`).join('\n');
        if (n.type === 'recommendationBox') {
          const d = n.attrs?.data as { text?: string; label?: string } | undefined;
          const t = (d?.text ?? '').trim();
          return t ? `${d?.label || 'Our recommendation'}: ${t}` : '';
        }
        if (n.type in EMBED_LABEL) return EMBED_LABEL[n.type];
        return nodeText(n);
      })
      .filter((s) => s.trim()).join('\n\n').trim();
  };
  const copyEmail = async () => {
    const text = emailText();
    const ok = () => { setCopied(true); setErr(null); setTimeout(() => setCopied(false), 1600); logClientActivity({ type: 'email-sent', title: `Email copied to send: ${proj.name}` }); };
    try { await navigator.clipboard.writeText(text); ok(); return; } catch { /* fall back below */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const done = document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) ok(); else setErr('Couldn’t copy here — use Export → Download .txt instead.');
    } catch { setErr('Couldn’t copy here — use Export → Download .txt instead.'); }
  };
  const downloadTxt = () => {
    const blob = new Blob([emailText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(inputs.companyName || 'email').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-email.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const refQ = refQuery.trim().toLowerCase();
  const shownRefs = refQ ? news.filter((n) => n.title.toLowerCase().includes(refQ) || n.source.toLowerCase().includes(refQ)) : news;
  const isEmail = inputs.documentChannel === 'email';

  return (
    <>
      {/* Doc action bar */}
      <div className="card px-3 py-2 flex flex-wrap items-center gap-2 sticky top-[var(--topbar-h)] z-20 mb-3">
        <FileText size={15} className="text-brand-greenDark shrink-0" />
        <span className="font-medium text-sm max-w-[260px] truncate" title={proj.name}>{proj.name}</span>
        <button onClick={renameProject} title="Rename report" className="text-brand-muted hover:text-brand-ink"><Pencil size={13} /></button>
        <span className="text-xs text-brand-muted">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : ''}</span>

        <div className="flex-1" />

        <div className="relative">
          <button className="btn-ghost !py-1.5" onClick={() => setShowVersions((v) => !v)} title="Version history">
            <History size={15} /> <span className="hidden sm:inline">Versions{proj.versions.length ? ` (${proj.versions.length})` : ''}</span>
          </button>
          {showVersions && (
            <div className="absolute right-0 mt-1 w-64 card p-1.5 z-30 max-h-64 overflow-auto" onMouseLeave={() => setShowVersions(false)}>
              {proj.versions.length ? [...proj.versions].reverse().map((v) => (
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
        {isEmail && (
          <button className="btn-ghost !py-1.5" onClick={copyEmail} title="Copy the email text to your clipboard">
            <Copy size={15} /> {copied ? 'Copied' : 'Copy email'}
          </button>
        )}
        <div className="relative">
          <button className="btn-ghost !py-1.5" onClick={() => setShowExport((v) => !v)} disabled={!!exporting}>
            <Download size={15} /> {exporting ? 'Exporting…' : 'Export'} <ChevronDown size={13} />
          </button>
          {showExport && (
            <div className="absolute right-0 mt-1 w-40 card p-1 z-30" onMouseLeave={() => setShowExport(false)}>
              {isEmail && <>
                <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); copyEmail(); }}>Copy email text</button>
                <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); downloadTxt(); }}>Download .txt</button>
              </>}
              {!isEmail && <>
                <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); download('pdf'); }}>Download PDF</button>
                <button className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => { setShowExport(false); download('docx'); }}>Download Word</button>
              </>}
            </div>
          )}
        </div>
      </div>

      {err && <p className="text-sm text-up mb-2">{err}</p>}

      {/* 3-zone layout: page thumbnails (documents only) · page · setup */}
      <div className={'grid grid-cols-1 gap-6 items-start ' + (isEmail ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : 'xl:grid-cols-[170px_minmax(0,1fr)_380px]')}>
        {!isEmail && <div className="hidden xl:block sticky top-[calc(var(--topbar-h)+44px)]"><PageOverview editor={editorInstance} /></div>}

        <div className="min-w-0 relative">
          <CommsEditor surface={isEmail ? 'email' : 'a4'} docKey={proj.id} initialDoc={doc} onChange={onDocChange} onReady={handleReady} onFiles={onUpload} onDropReference={onDropReference} />
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
          <CollapsibleSection title="Client profile" icon={Building2} defaultOpen={false} persistKey="tray-client">
            <div className="space-y-3">
              {FIELD_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="label mb-1.5">{g.label}</div>
                  <div className="space-y-2">
                    {g.keys.map((key) => (
                      <div key={key}>
                        <label className="text-[11px] text-brand-muted block mb-0.5">{FIELDS[key].label}</label>
                        <input className="input !py-1.5 text-sm" placeholder={FIELDS[key].placeholder} value={inputs[key] ?? ''} onChange={(e) => setField(key, e.target.value)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="References &amp; media"
            icon={Library}
            defaultOpen
            persistKey="tray-references"
            right={<span className="text-[11px] text-brand-muted font-normal">{news.length} articles · {files.length} files</span>}
          >
            <div className="space-y-3">
              {/* Articles | Files segmented tabs */}
              <div className="flex gap-1 p-0.5 bg-brand-surface rounded-lg">
                {(['articles', 'files'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRefTab(t)}
                    className={'flex-1 text-xs py-1 rounded-md transition ' + (refTab === t ? 'bg-white shadow-soft text-brand-ink font-medium' : 'text-brand-muted hover:text-brand-ink')}
                  >
                    {t === 'articles' ? `Articles · ${news.length}` : `Files · ${files.length}`}
                  </button>
                ))}
              </div>

              {refTab === 'articles' ? (
                <>
                  <div className="flex gap-1.5">
                    <input className="input !py-1.5 text-sm flex-1" placeholder="Paste an article URL…" value={refUrl} onChange={(e) => setRefUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addRefUrl(); }} />
                    <button className="btn-ghost !py-1.5 !px-2" onClick={addRefUrl} disabled={addingUrl || !refUrl.trim()} title="Fetch & add to library">{addingUrl ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}</button>
                  </div>
                  <div className="label">Tick to use as context, ＋ to insert</div>
                  {news.length > 6 && (
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none" />
                      <input className="input !py-1 !pl-7 text-xs" placeholder="Filter articles…" value={refQuery} onChange={(e) => setRefQuery(e.target.value)} />
                    </div>
                  )}
                  <div className="space-y-0.5 max-h-56 overflow-auto pr-1">
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
                </>
              ) : (
                <>
                  {files.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 max-h-72 overflow-auto pr-1">
                      {files.map((f) => {
                        const clientFile = f.projectId !== proj.id;
                        const isImage = f.mime.startsWith('image/');
                        return (
                          <div key={f.id} draggable onDragStart={dragRef('file', f.id)} className="group relative border border-brand-line rounded-lg overflow-hidden cursor-grab bg-white" title={`${f.name} — drag onto the page to insert`}>
                            <div className="aspect-[4/3] bg-brand-surface grid place-items-center overflow-hidden">
                              {isImage
                                ? <img src={api.files.downloadUrl(f.id)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
                                : <FileText size={26} className="text-brand-muted" />}
                            </div>
                            <div className="absolute inset-x-0 top-0 flex justify-end gap-1 p-1 opacity-0 group-hover:opacity-100 transition">
                              <button className="h-6 w-6 grid place-items-center rounded-md bg-white/95 shadow-soft text-brand-muted hover:text-brand-green" onClick={() => insertFile(f)} title="Insert into report"><Plus size={14} /></button>
                              {!clientFile && <button className="h-6 w-6 grid place-items-center rounded-md bg-white/95 shadow-soft text-brand-muted hover:text-up" onClick={() => removeUpload(f.id)} title="Remove"><Trash2 size={13} /></button>}
                            </div>
                            <div className="px-1.5 py-1 flex items-center gap-1">
                              <span className="flex-1 truncate text-[11px]" title={f.name}>{f.name}</span>
                              {clientFile && <span className="text-[8px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0" title="From this client’s media bank">client</span>}
                              {f.extractedText && <span className="text-[8px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0" title="Text read for context">ctx</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-brand-muted">No files yet — upload a bill, LOA or image below.</p>
                  )}
                  <label className="btn-ghost w-full cursor-pointer justify-center !py-1.5 text-sm">
                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Upload file or image
                    <input type="file" multiple className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
                  </label>
                  <p className="text-[11px] text-brand-muted">Drag any tile onto the page to insert it where you drop it; PDFs/Word are mined for context.</p>
                </>
              )}
            </div>
          </CollapsibleSection>

          {convos.length > 0 && (
            <CollapsibleSection
              title="Past conversations"
              icon={MessagesSquare}
              defaultOpen={false}
              persistKey="tray-conversations"
              right={<span className="text-[11px] text-brand-muted font-normal">{selectedConvos.size}/{convos.length} linked</span>}
            >
              <p className="label mb-1.5">Tick a conversation to ground this draft in what was said.</p>
              <div className="space-y-0.5 max-h-44 overflow-auto pr-1">
                {convos.map((a) => {
                  const Icon = CONVO_ICON[a.type] ?? MessagesSquare;
                  return (
                    <label key={a.id} className="flex items-start gap-1.5 text-xs py-0.5 cursor-pointer">
                      <input type="checkbox" className="mt-0.5 accent-brand-green shrink-0" checked={selectedConvos.has(a.id)} onChange={() => toggleConvo(a.id)} />
                      <Icon size={12} className="mt-0.5 text-brand-greenDark shrink-0" />
                      <span className="flex-1 leading-snug">{a.title}</span>
                      <span className="text-brand-muted shrink-0">{relativeTime(a.at)}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-brand-muted mt-1.5">Their summary, key points and talk-track angles are woven in as context — never restated as fact.</p>
            </CollapsibleSection>
          )}

          <CollapsibleSection title="Your input" icon={PenLine} defaultOpen persistKey="tray-input">
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
