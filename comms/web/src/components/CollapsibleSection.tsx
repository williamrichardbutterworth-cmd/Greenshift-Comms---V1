import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { usePersisted } from '../lib/usePersisted';

// A titled, collapsible panel section. Open/close is smoothly height-animated
// (grid-rows 1fr⇄0fr trick). Pass `persistKey` to remember the open state across
// sessions; otherwise it's local component state seeded by `defaultOpen`.
export function CollapsibleSection({
  title, icon: Icon, defaultOpen = true, right, persistKey, children,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  right?: ReactNode;
  persistKey?: string;
  children: ReactNode;
}) {
  // Both hooks always run (rules-of-hooks); we use whichever the caller opted into.
  const local = useState(defaultOpen);
  const persisted = usePersisted<boolean>(`comms.collapse.${persistKey ?? ''}`, defaultOpen);
  const [open, setOpen] = persistKey ? persisted : local;

  return (
    <div className="border border-brand-line rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold hover:bg-brand-surface transition"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronDown size={15} className={'text-brand-muted transition-transform ' + (open ? '' : '-rotate-90')} />
        {Icon && <Icon size={15} className="text-brand-greenDark" />}
        <span className="flex-1 text-left">{title}</span>
        {right}
      </button>
      <div className={'grid transition-[grid-template-rows] duration-200 ease-out ' + (open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
