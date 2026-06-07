import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { Newspaper, Plus, Trash2 } from 'lucide-react';
import { api, type NewsItem, type NewsRef } from '../../lib/api';
import { NodeShell } from '../NodeShell';

function NewsListView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const items = (node.attrs.items as NewsRef[]) ?? [];
  const [available, setAvailable] = useState<NewsItem[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.news(12).then(setAvailable).catch(() => setAvailable([]));
  }, []);

  const removeAt = (idx: number) => updateAttributes({ items: items.filter((_, i) => i !== idx) });
  const add = (n: NewsItem) => {
    setAdding(false);
    if (items.some((it) => it.title === n.title)) return;
    updateAttributes({ items: [...items, { source: n.source, title: n.title, url: n.url }] });
  };
  const unused = available.filter((n) => !items.some((it) => it.title === n.title));

  return (
    <NodeShell
      label="Supporting evidence"
      icon={Newspaper}
      selected={selected}
      onDelete={deleteNode}
      actions={
        <button className="btn-ghost !px-1.5 !py-1 shrink-0" onClick={() => setAdding((v) => !v)} title="Add article">
          <Plus size={15} />
        </button>
      }
    >
      <div className="space-y-1">
        {adding && (
          <div className="rounded-lg border border-brand-line p-2 mb-2 max-h-40 overflow-auto space-y-1">
            {unused.length ? unused.map((n) => (
              <button key={n.id} className="block w-full text-left text-sm hover:bg-brand-tint rounded px-1.5 py-1" onClick={() => add(n)}>
                <span className="text-brand-greenDark">{n.source}:</span> {n.title}
              </button>
            )) : <p className="text-xs text-brand-muted px-1">No more articles in the current feed.</p>}
          </div>
        )}
        {items.map((it, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm">
            <span className="flex-1"><span className="text-brand-greenDark">{it.source}:</span> {it.title}</span>
            <button className="btn-ghost !px-1 !py-0.5 hover:text-up shrink-0" onClick={() => removeAt(idx)} title="Remove">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!items.length && <p className="text-xs text-brand-muted">No items — use the + button to add articles.</p>}
      </div>
    </NodeShell>
  );
}

export const NewsList = Node.create({
  name: 'newsList',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { items: { default: [] as NewsRef[] } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="news-list"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'news-list' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(NewsListView);
  },
});
