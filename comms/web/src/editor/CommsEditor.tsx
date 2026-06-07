import { useEffect, useState, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Heading2, Heading3, List, ListOrdered, Quote, Link2,
  Table2, LineChart as LineChartIcon, BarChart3, Newspaper, Plus,
  Sparkles, ChevronDown, Loader2,
} from 'lucide-react';
import { api, type ReportDoc, type EditAction } from '../lib/api';
import { MetricsTable, metricToRow } from './nodes/MetricsTable';
import { PriceChart, defaultChart } from './nodes/PriceChart';
import { NewsList } from './nodes/NewsList';
import { CustomChart, defaultCustomChart } from './nodes/CustomChart';

const heading2 = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });

const AI_ACTIONS: { action: EditAction; label: string }[] = [
  { action: 'concise', label: 'Make concise' },
  { action: 'expand', label: 'Expand' },
  { action: 'addData', label: 'Add a market figure' },
  { action: 'rewrite', label: 'Rewrite' },
  { action: 'regenerate', label: 'Regenerate' },
];

export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', class: 'report-link' } }),
  Placeholder.configure({ placeholder: 'Start writing, or attach context on the left and click “Assemble with AI”…' }),
  MetricsTable,
  PriceChart,
  NewsList,
  CustomChart,
];

function ToolbarButton({
  onClick, active, disabled, title, children,
}: { onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex items-center justify-center h-8 w-8 rounded-md border text-sm transition disabled:opacity-40 ' +
        (active
          ? 'bg-brand-green text-white border-brand-green'
          : 'bg-white text-brand-ink border-brand-line hover:bg-brand-tint')
      }
    >
      {children}
    </button>
  );
}

export function CommsEditor({
  docKey,
  initialDoc,
  onChange,
  onReady,
}: {
  docKey: string;
  initialDoc: ReportDoc;
  onChange: (doc: ReportDoc) => void;
  onReady?: (editor: Editor) => void;
}) {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAction, setAiAction] = useState<EditAction | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialDoc,
    editorProps: { attributes: { class: 'report-canvas' } },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as ReportDoc),
  });

  // Surface the instance to the workspace for AI assembly / inline edits / export.
  useEffect(() => {
    if (editor && onReady) onReady(editor);
  }, [editor, onReady]);

  // Load a different project / restored version without emitting an update
  // (avoids bouncing the freshly-loaded doc straight back into autosave).
  useEffect(() => {
    if (editor) editor.commands.setContent(initialDoc, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  if (!editor) return null;

  const addHeadingAndNode = (node: Record<string, unknown>, title: string) => {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, [heading2(title), node]).run();
  };
  const addMetrics = async () => {
    let rows: ReturnType<typeof metricToRow>[] = [];
    let asOf: string | undefined;
    try {
      const snap = await api.market();
      rows = snap.metrics.map(metricToRow);
      asOf = new Date(snap.asOf).toLocaleString('en-GB');
    } catch { /* insert empty; the node lets you tick metrics later */ }
    addHeadingAndNode({ type: 'metricsTable', attrs: { rows, asOf } }, 'Market data');
  };
  const addPriceChart = () => addHeadingAndNode({ type: 'priceChart', attrs: { chart: defaultChart() } }, 'Price trend');
  const addCustomChart = () => addHeadingAndNode({ type: 'customChart', attrs: { data: defaultCustomChart() } }, 'Custom analysis');
  const addNews = () => addHeadingAndNode({ type: 'newsList', attrs: { items: [] } }, 'Supporting evidence');

  const setLink = () => {
    const prev = (editor.getAttributes('link').href as string) ?? '';
    const url = window.prompt('Link URL', prev);
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  // Inline AI: rewrite the selection (or, if nothing is selected, the current
  // paragraph) via /api/report/edit, then splice the result back in.
  const runAI = async (action: EditAction) => {
    setAiOpen(false);
    setAiErr(null);
    const sel = editor.state.selection;
    let { from, to } = sel;
    if (sel.empty) { from = sel.$from.start(); to = sel.$from.end(); }
    const text = editor.state.doc.textBetween(from, to, '\n').trim();
    if (!text) { setAiErr('Select some text — or click into a paragraph — first.'); return; }
    setAiAction(action);
    try {
      const res = await api.editReport(action, text);
      if (res.error) setAiErr(`AI unavailable: ${res.error.slice(0, 140)}`);
      else if (res.text && res.text !== text) editor.chain().focus().insertContentAt({ from, to }, res.text).run();
    } catch (e) {
      setAiErr(String((e as Error).message).slice(0, 160));
    } finally {
      setAiAction(null);
    }
  };

  return (
    <div className="card overflow-hidden">
      {/* Formatting toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-brand-line bg-brand-surface sticky top-[57px] z-[5]">
        <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolbarButton>
        <span className="w-px h-5 bg-brand-line mx-0.5" />
        <ToolbarButton title="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></ToolbarButton>
        <ToolbarButton title="Subheading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} /></ToolbarButton>
        <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={15} /></ToolbarButton>
        <ToolbarButton title="Link" active={editor.isActive('link')} onClick={setLink}><Link2 size={15} /></ToolbarButton>
        <span className="w-px h-5 bg-brand-line mx-0.5" />
        <div className="relative">
          <button
            type="button"
            title="AI edit the selected text (or current paragraph)"
            onClick={() => setAiOpen((o) => !o)}
            disabled={!!aiAction}
            className="inline-flex items-center gap-1 h-8 px-2 rounded-md border text-sm bg-white text-brand-greenDark border-brand-line hover:bg-brand-tint disabled:opacity-50"
          >
            {aiAction ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI <ChevronDown size={12} />
          </button>
          {aiOpen && (
            <div className="absolute left-0 mt-1 w-48 card p-1 z-20" onMouseLeave={() => setAiOpen(false)}>
              {AI_ACTIONS.map((a) => (
                <button key={a.action} className="block w-full text-left text-sm px-2 py-1.5 rounded hover:bg-brand-tint" onClick={() => runAI(a.action)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="flex-1" />
        <span className="label hidden sm:inline mr-1">Insert</span>
        <ToolbarButton title="Market metrics" onClick={addMetrics}><Table2 size={15} /></ToolbarButton>
        <ToolbarButton title="Price chart" onClick={addPriceChart}><LineChartIcon size={15} /></ToolbarButton>
        <ToolbarButton title="Custom chart" onClick={addCustomChart}><BarChart3 size={15} /></ToolbarButton>
        <ToolbarButton title="News evidence" onClick={addNews}><Newspaper size={15} /></ToolbarButton>
      </div>

      {aiErr && <div className="px-3 py-1.5 text-xs text-up bg-brand-tint border-b border-brand-line">{aiErr}</div>}

      {/* The document canvas */}
      <EditorContent editor={editor} className="report-canvas-wrap px-6 py-5 min-h-[60vh] max-h-[72vh] overflow-auto" />

      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-brand-line text-[11px] text-brand-muted">
        <Plus size={12} /> Type to write · use the toolbar to format · drag the handle on any block to reorder
      </div>
    </div>
  );
}
