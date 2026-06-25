import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { CheckCircle2 } from 'lucide-react';
import type { RecommendationBoxData } from '../../lib/api';
import { NodeShell } from '../NodeShell';

// A styled "OUR RECOMMENDATION" verdict box — tint fill + green left rule. The
// text is AI-written (buildDocFromSections routes the report's recommendation
// section here) or typed by the agent; this is what makes the document read as
// considered advice rather than a data dump.

export const defaultRecommendation = (): RecommendationBoxData => ({ text: '', label: 'Our recommendation' });

function RecommendationBoxView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const data = (node.attrs.data as RecommendationBoxData) ?? defaultRecommendation();
  const label = data.label || 'Our recommendation';
  return (
    <NodeShell label="Recommendation" icon={CheckCircle2} selected={selected} onDelete={deleteNode}>
      <div className="rounded-lg bg-brand-tint border-l-4 border-brand-green pl-4 pr-3 py-3">
        <div className="flex items-center gap-1.5 text-brand-greenDark text-[11px] font-semibold uppercase tracking-wide mb-1.5">
          <CheckCircle2 size={13} /> {label}
        </div>
        <textarea
          className="w-full bg-transparent resize-none text-sm text-brand-ink leading-relaxed outline-none min-h-[60px]"
          value={data.text}
          placeholder="Our clear recommendation, tailored to this client…"
          onChange={(e) => updateAttributes({ data: { ...data, text: e.target.value } })}
        />
      </div>
    </NodeShell>
  );
}

export const RecommendationBox = Node.create({
  name: 'recommendationBox',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { data: { default: defaultRecommendation() } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="recommendation-box"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'recommendation-box' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RecommendationBoxView);
  },
});
