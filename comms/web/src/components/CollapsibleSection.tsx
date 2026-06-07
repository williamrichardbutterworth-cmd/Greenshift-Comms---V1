import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

// A titled, collapsible panel section for the report setup sidebar.
export function CollapsibleSection({
  title, icon: Icon, defaultOpen = true, right, children,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-brand-line rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold hover:bg-brand-surface transition"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={15} className={'text-brand-muted transition-transform ' + (open ? '' : '-rotate-90')} />
        {Icon && <Icon size={15} className="text-brand-greenDark" />}
        <span className="flex-1 text-left">{title}</span>
        {right}
      </button>
      {open && <div className="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
}
