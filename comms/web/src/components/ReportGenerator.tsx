import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Sparkles, Download, FileText, Trash2, FilePlus2, History, Save, FolderOpen, Pencil, RotateCcw,
  Paperclip, Loader2,
} from 'lucide-react';
import {
  api, EMPTY_DOC,
  type NewsItem, type ReportInputs, type MarketSnapshot, type ReportDoc,
  type ReportProject, type ReportProjectSummary, type ReportVersion, type NewsRef, type ClientFile,
} from '../lib/api';
import { CommsEditor } from '../editor/CommsEditor';
import { ClientProfileForm } from './ClientProfileForm';
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

const toRef = (n: NewsItem): NewsRef => ({ source: n.source, title: n.title, url: n.url });

const docHasMarketData = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type === 'metricsTable' || n.type === 'priceChart');

// A document is "non-empty" if it has anything beyond a single blank paragraph.
const docHasContent = (doc: ReportDoc): boolean =>
  (doc.content ?? []).some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0);

export function ReportGenerator() {
  const [projects, setProjects] = useState<ReportProjectSummary[]>([]);
  const [current, setCurrent] = useState<ReportProject | null>(null);
  const [inputs, setInputs] = useState<ReportInputs>({});
  const [doc, setDoc] = useState<ReportDoc>(EMPTY_DOC);
  const [docKey, setDocKey] = useState('none');
  const editorRef = useRef<Editor | null>(null);
  const dirty = useRef(false);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [provider, setProvider] = useState('');

  // AI context tray (assembly inputs — not part of the saved document)
  const [ctxSnapshot, setCtxSnapshot] = useState(true);
  const [ctxBrief, setCtxBrief] = useState(false);
  const [ctxNotes, setCtxNotes] = useState('');

  const [drafting, setDrafting] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showVersions, setShowVersions] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const refreshProjects = () => api.projects.list().then(setProjects).catch(() => {});

  useEffect(() => {
    refreshProjects();
    api.news(10).then(setNews).catch(() => setNews([]));
  }, []);

  // ── Debounced autosave of the live document + client profile ──
  useEffect(() => {
    if (!current || !dirty.current) return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        const saved = await api.projects.update(current.id, { doc, inputs });
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
  }, [doc, inputs, current]);

  const markDirty = () => { dirty.current = true; };
  const handleReady = useCallback((e: Editor) => { editorRef.current = e; }, []);
  const onDocChange = (d: ReportDoc) => { markDirty(); setDoc(d); };
  const setField = (k: keyof ReportInputs, v: string) => { markDirty(); setInputs((s) => ({ ...s, [k]: v })); };

  // ── Project lifecycle ──
  const resetTransient = () => { setSnapshot(null); setProvider(''); setSelected(new Set()); setShowVersions(false); setErr(null); setCtxNotes(''); setFiles([]); };
  const loadFiles = (projectId: string) => api.files.list({ projectId }).then(setFiles).catch(() => setFiles([]));

  // New report → client-profile step → enter the freshly-created project.
  const onProfileDone = (p: ReportProject) => {
    dirty.current = false;
    setCreating(false);
    setCurrent(p); setInputs(p.inputs ?? {}); setDoc(p.doc ?? EMPTY_DOC); setDocKey(p.id);
    resetTransient(); loadFiles(p.id); refreshProjects();
  };
  const openProject = async (id: string) => {
    try {
      const p = await api.projects.get(id);
      dirty.current = false;
      setCurrent(p); setInputs(p.inputs ?? {}); setDoc(p.doc ?? EMPTY_DOC); setDocKey(p.id);
      resetTransient(); loadFiles(p.id);
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const renameProject = async () => {
    if (!current) return;
    const name = window.prompt('Report name', current.name);
    if (!name) return;
    try {
      const saved = await api.projects.update(current.id, { name });
      setCurrent(saved); refreshProjects();
    } catch (e) { setErr(String((e as Error).message)); }
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
      const saved = await api.projects.update(current.id, { doc, inputs, saveVersion: true, versionLabel: label });
      dirty.current = false;
      setCurrent(saved); setSaveState('saved'); refreshProjects();
    } catch (e) { setErr(String((e as Error).message)); }
  };
  const restoreVersion = (v: ReportVersion) => {
    markDirty();
    setInputs(v.inputs ?? {});
    if (editorRef.current) editorRef.current.commands.setContent(v.doc, true);
    else setDoc(v.doc);
    setShowVersions(false);
  };

  // ── Evidence + AI draft ──
  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectedNews = () => news.filter((n) => selected.has(n.id));

  // ── Files & media: upload (extract text server-side), embed images, remove ──
  const onUpload = async (fileList: FileList | null) => {
    if (!fileList || !current) return;
    setUploading(true); setErr(null);
    try {
      for (const file of Array.from(fileList)) {
        const dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result as string);
          r.onerror = rej;
          r.readAsDataURL(file);
        });
        const base64 = dataUrl.split(',')[1] ?? '';
        const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, projectId: current.id });
        setFiles((f) => [saved, ...f]);
        if (file.type.startsWith('image/')) editorRef.current?.chain().focus().setImage({ src: dataUrl }).run();
      }
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setUploading(false);
    }
  };
  const removeUpload = async (id: string) => {
    try { await api.files.remove(id); setFiles((f) => f.filter((x) => x.id !== id)); }
    catch (e) { setErr(String((e as Error).message)); }
  };

  const assemble = async () => {
    if (!current) return;
    if (docHasContent(doc) && !window.confirm('Assembling a draft will replace the current document. Continue?')) return;
    setDrafting(true); setErr(null);
    try {
      let dailyBrief: string | null = null;
      if (ctxBrief) { try { dailyBrief = (await api.dailyReview()).review ?? null; } catch { /* ignore */ } }
      const sel = selectedNews();
      const fileNotes = files
        .filter((f) => f.extractedText.trim())
        .map((f) => `From “${f.name}”:\n${f.extractedText.slice(0, 3000)}`)
        .join('\n\n');
      const res = await api.assembleReport(inputs, {
        selectedNews: sel.map((n) => ({ source: n.source, title: n.title, summary: n.summary })),
        includeSnapshot: ctxSnapshot,
        dailyBrief,
        extraNotes: [ctxNotes, fileNotes].filter(Boolean).join('\n\n'),
      });
      setSnapshot(res.snapshot); setProvider(res.provider);
      if (res.provider === 'error' && res.note) {
        setErr(`Auto-drafting unavailable (${res.note.slice(0, 150)}). Built an editable skeleton you can fill in.`);
      }
      const built = buildDocFromSections(res.sections, { snapshot: res.snapshot, selectedNews: sel.map(toRef) });
      markDirty();
      if (editorRef.current) editorRef.current.commands.setContent(built, true);
      else setDoc(built);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setDrafting(false);
    }
  };

  // ── Export ──
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
      const exp = await import('../lib/exportReport'); // lazy-load heavy PDF/Word libs
      const { blob, filename } = fmt === 'pdf'
        ? await exp.exportReportPdf(inputs, liveDoc, meta)
        : await exp.exportReportDocx(inputs, liveDoc, meta);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      {creating && <ClientProfileForm onDone={onProfileDone} onCancel={() => setCreating(false)} />}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      {/* ── Left: projects + client profile + evidence ── */}
      <div className="space-y-5">
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Reports</h2>
            <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setCreating(true)}><FilePlus2 size={13} /> New</button>
          </div>
          <div className="space-y-0.5 max-h-56 overflow-auto">
            {projects.map((p) => (
              <div
                key={p.id}
                className={'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm cursor-pointer ' +
                  (current?.id === p.id ? 'bg-brand-tint' : 'hover:bg-brand-surface')}
                onClick={() => openProject(p.id)}
              >
                <FolderOpen size={13} className="text-brand-muted shrink-0" />
                <span className="flex-1 truncate">{p.name}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-up shrink-0"
                  onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}
                  title="Delete report"
                ><Trash2 size={13} /></button>
              </div>
            ))}
            {!projects.length && <p className="text-xs text-brand-muted px-1 py-2">No saved reports yet — click “New”.</p>}
          </div>
        </div>

        {current && (
          <>
            <div>
              <h3 className="label mb-2">Client profile</h3>
              <div className="space-y-3">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="label block mb-1">{f.label}</label>
                    <input className="input" placeholder={f.placeholder} value={inputs[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} />
                  </div>
                ))}
                <div>
                  <label className="label block mb-1">Notes / your projections</label>
                  <textarea
                    className="input min-h-[80px]"
                    placeholder="Anything specific to weave in (budget, risk appetite, renewal goals)…"
                    value={inputs.agentNotes ?? ''}
                    onChange={(e) => setField('agentNotes', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="label mb-2">Context</h3>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-brand-green" checked={ctxSnapshot} onChange={(e) => setCtxSnapshot(e.target.checked)} />
                  Include live market snapshot
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="accent-brand-green" checked={ctxBrief} onChange={(e) => setCtxBrief(e.target.checked)} />
                  Include today’s market brief
                </label>
                <div>
                  <label className="label block mb-1">Extra context</label>
                  <textarea
                    className="input min-h-[56px]"
                    placeholder="Anything else to weave in…"
                    value={ctxNotes}
                    onChange={(e) => setCtxNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="label mb-2">Attach evidence (news)</h3>
              <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
                {news.map((n) => (
                  <label key={n.id} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-1 accent-brand-green" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                    <span><span className="text-brand-greenDark">{n.source}:</span> {n.title}</span>
                  </label>
                ))}
                {!news.length && <p className="text-sm text-brand-muted">No news loaded.</p>}
              </div>
            </div>

            <div>
              <h3 className="label mb-2">Files &amp; media</h3>
              <label className="btn-ghost w-full cursor-pointer justify-center">
                {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Upload file or image
                <input type="file" multiple className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
              </label>
              {files.length > 0 && (
                <div className="space-y-1 mt-2 max-h-40 overflow-auto">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 text-xs">
                      <FileText size={12} className="text-brand-muted shrink-0" />
                      <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                      {f.extractedText && <span className="text-[10px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0" title="Text extracted for the draft">context</span>}
                      <button className="text-brand-muted hover:text-up shrink-0" onClick={() => removeUpload(f.id)} title="Remove"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-brand-muted mt-1.5">PDFs &amp; Word docs are mined for context; images embed into the page.</p>
            </div>

            <div>
              <button className="btn-primary w-full" onClick={assemble} disabled={drafting}>
                <Sparkles size={16} /> {drafting ? 'Assembling…' : 'Assemble draft'}
              </button>
              {provider === 'none' && (
                <p className="text-xs text-brand-muted mt-1.5">Automatic drafting isn’t set up — a structured skeleton is built that you can fill in and format.</p>
              )}
              <p className="text-[11px] text-brand-muted mt-1.5">Assembling replaces the document with a fresh draft from the context above.</p>
            </div>
          </>
        )}
      </div>

      {/* ── Right: the document editor ── */}
      <div className="space-y-3">
        {err && <p className="text-sm text-up">{err}</p>}

        {!current ? (
          <div className="card p-10 text-center text-brand-muted">
            <FileText size={28} className="mx-auto mb-2 opacity-50" />
            Create or open a report to start writing.
            <div className="mt-3"><button className="btn-primary" onClick={() => setCreating(true)}><FilePlus2 size={16} /> New report</button></div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex items-center gap-1.5 text-lg font-semibold hover:text-brand-greenDark" onClick={renameProject} title="Rename report">
                {current.name} <Pencil size={13} className="text-brand-muted" />
              </button>
              <span className="text-xs text-brand-muted">
                {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : ''}
              </span>
              <div className="flex-1" />
              <div className="relative">
                <button className="btn-ghost !py-1.5" onClick={() => setShowVersions((v) => !v)} title="Version history">
                  <History size={15} /> Versions{current.versions.length ? ` (${current.versions.length})` : ''}
                </button>
                {showVersions && (
                  <div className="absolute right-0 mt-1 w-64 card p-1.5 z-20 max-h-64 overflow-auto">
                    {current.versions.length ? [...current.versions].reverse().map((v) => (
                      <div key={v.at} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-brand-surface text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{v.label}</div>
                          <div className="text-[11px] text-brand-muted">{new Date(v.at).toLocaleString('en-GB')}</div>
                        </div>
                        <button className="btn-ghost !px-1.5 !py-1" onClick={() => restoreVersion(v)} title="Restore this version"><RotateCcw size={13} /></button>
                      </div>
                    )) : <p className="text-xs text-brand-muted px-2 py-2">No saved versions yet.</p>}
                  </div>
                )}
              </div>
              <button className="btn-ghost !py-1.5" onClick={saveVersion} title="Snapshot current state"><Save size={15} /> Save version</button>
            </div>

            <CommsEditor docKey={docKey} initialDoc={doc} onChange={onDocChange} onReady={handleReady} />

            <div className="flex items-center gap-2 pt-1">
              <button className="btn-primary" onClick={() => download('pdf')} disabled={!!exporting}>
                <Download size={16} /> {exporting === 'pdf' ? 'Building PDF…' : 'Download PDF'}
              </button>
              <button className="btn-ghost" onClick={() => download('docx')} disabled={!!exporting}>
                <FileText size={16} /> {exporting === 'docx' ? 'Building Word…' : 'Download Word'}
              </button>
            </div>
            <p className="text-[11px] text-brand-muted">
              Auto-drafted — review and edit before sending. Prices are indicative, not a quotation; general market commentary, not financial advice.
            </p>
          </>
        )}
      </div>
      </div>
    </>
  );
}
