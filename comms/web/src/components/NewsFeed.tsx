import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api, type NewsItem } from '../lib/api';

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NewsFeed() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.news(15).then(setItems).catch((e) => setErr(String(e.message)));
  }, []);

  if (err) return <p className="text-sm text-up">Couldn’t load news: {err}</p>;
  if (!items) return <p className="text-sm text-brand-muted">Loading news…</p>;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Market news</h2>
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id} className="card p-4">
            <div className="flex items-center gap-2 text-[11px] text-brand-muted mb-1">
              <span className="font-medium text-brand-greenDark">{n.source}</span>
              <span>·</span>
              <span>{ago(n.publishedAt)}</span>
            </div>
            <a
              href={n.url || undefined}
              target="_blank"
              rel="noreferrer"
              className="text-[15px] font-medium hover:text-brand-green inline-flex items-start gap-1"
            >
              {n.title}
              {n.url && <ExternalLink size={13} className="mt-1 shrink-0 text-brand-muted" />}
            </a>
            {n.summary && <p className="text-sm text-brand-muted mt-1 leading-snug">{n.summary}</p>}
            {n.angle && (
              <p className="text-sm text-brand-greenDark mt-2">
                <span className="label mr-1">Call angle</span>
                {n.angle}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
