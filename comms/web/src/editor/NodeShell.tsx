import { NodeViewWrapper } from '@tiptap/react';
import { GripVertical, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

// Shared chrome for the embedded block nodes (metrics / charts / news). Renders
// the required NodeViewWrapper root, a drag handle, a type chip and a delete
// button. The interactive body is marked contentEditable={false} so form
// controls inside the node work without ProseMirror hijacking events.
export function NodeShell({
  label,
  icon: Icon,
  selected,
  onDelete,
  children,
  actions,
}: {
  label: string;
  icon: typeof Trash2;
  selected: boolean;
  onDelete: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <NodeViewWrapper
      className={'card p-3 my-3 ' + (selected ? 'ring-2 ring-brand-green/40' : '')}
    >
      <div className="flex items-center gap-2 mb-2" contentEditable={false}>
        <span
          data-drag-handle
          draggable
          className="cursor-grab text-brand-muted hover:text-brand-ink shrink-0"
          title="Drag to reorder"
        >
          <GripVertical size={15} />
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-brand-greenDark bg-brand-tint px-1.5 py-0.5 rounded">
          <Icon size={11} /> {label}
        </span>
        <div className="flex-1" />
        {actions}
        <button
          className="btn-ghost !px-1.5 !py-1 hover:text-up shrink-0"
          onClick={onDelete}
          title="Remove block"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div contentEditable={false}>{children}</div>
    </NodeViewWrapper>
  );
}
