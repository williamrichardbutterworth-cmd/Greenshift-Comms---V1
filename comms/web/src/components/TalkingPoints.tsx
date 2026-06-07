import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { TalkingPoint } from '../lib/api';

const BADGE: Record<string, string> = {
  fact: 'bg-brand-tint text-brand-greenDark',
  statement: 'bg-brand-ink/5 text-brand-ink',
  question: 'bg-amber-50 text-amber-700',
};

export function TalkingPoints({ points }: { points: TalkingPoint[] }) {
  const [copied, setCopied] = useState<number | null>(null);

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  if (!points.length) return null;

  return (
    <ul className="space-y-2">
      {points.map((p, i) => (
        <li key={i} className="card p-3 flex items-start gap-3">
          <span
            className={
              'shrink-0 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ' +
              (BADGE[p.type] ?? 'bg-brand-ink/5 text-brand-ink')
            }
          >
            {p.type}
          </span>
          <span className="flex-1 text-sm leading-snug">{p.text}</span>
          <button
            onClick={() => copy(p.text, i)}
            className="shrink-0 text-brand-muted hover:text-brand-green transition"
            title="Copy"
          >
            {copied === i ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </li>
      ))}
    </ul>
  );
}
