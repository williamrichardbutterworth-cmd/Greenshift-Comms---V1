import { useEffect, useState } from 'react';
import { RefreshCw, Globe2, Info, Copy, Check, Clock } from 'lucide-react';
import { api, type DailyReview as DR } from '../lib/api';
import { TalkingPoints } from './TalkingPoints';

type TabKey = 'all' | 'fact' | 'statement' | 'question';
const TP_TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'fact', label: 'Facts' },
  { key: 'statement', label: 'Statements' },
  { key: 'question', label: 'Questions' },
];

export function DailyReview() {
  const [data, setData] = useState<DR | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>('all');
  const [copiedAll, setCopiedAll] = useState(false);

  const load = (refresh = false) => {
    setBusy(true);
    setErr(null);
    (refresh ? api.refreshReview() : api.dailyReview())
      .then(setData)
      .catch((e) => setErr(String(e.message)))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(false), []);

  const points = data?.talkingPoints ?? [];
  const shown = tab === 'all' ? points : points.filter((p) => p.type === tab);
  const count = (t: TabKey) => (t === 'all' ? points.length : points.filter((p) => p.type === t).length);

  const copyAll = async () => {
    if (!data) return;
    const text = [
      data.review,
      '',
      'TALKING POINTS',
      ...points.map((p) => `• [${p.type}] ${p.text}`),
      ...(data.geoHooks.length ? ['', 'GEOPOLITICAL ANGLES', ...data.geoHooks.map((g) => `• ${g.headline} — ${g.angle}`)] : []),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-5">
      {/* Control bar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-lg font-semibold">Daily market brief</h2>
          {data && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-brand-muted">
              <Clock size={12} /> {new Date(data.asOf).toLocaleString('en-GB')}
            </span>
          )}
        </div>
        <div className="flex-1" />
        <button className="btn-ghost !py-1.5" onClick={copyAll} disabled={!data}>
          {copiedAll ? <Check size={15} /> : <Copy size={15} />} {copiedAll ? 'Copied' : 'Copy brief'}
        </button>
        <button className="btn-primary !py-1.5" onClick={() => load(true)} disabled={busy}>
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {err && <p className="text-sm text-up">Couldn’t load the brief: {err}</p>}
      {!data && !err && <p className="text-sm text-brand-muted">Loading…</p>}

      {data && (
        <>
          {!data.configured && (
            <div className="card p-3 flex gap-2 items-start bg-amber-50 border-amber-200">
              <Info size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800">{data.note}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
            {/* Left: summary + geo angles */}
            <div className="space-y-5">
              <section className="card p-5">
                <div className="label mb-2">Market summary</div>
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{data.review}</p>
              </section>

              {data.geoHooks.length > 0 && (
                <section>
                  <div className="label mb-2">Geopolitical angles</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {data.geoHooks.map((g, i) => (
                      <div key={i} className="card p-3 flex items-start gap-2">
                        <Globe2 size={15} className="text-brand-green mt-0.5 shrink-0" />
                        <div>
                          <div className="text-sm font-medium">{g.headline}</div>
                          <div className="text-sm text-brand-muted mt-0.5">{g.angle}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Right: talking-points control panel */}
            <section className="card p-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
              <div className="label mb-2">Talking points</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {TP_TABS.map((t) => {
                  const n = count(t.key);
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      disabled={t.key !== 'all' && n === 0}
                      className={
                        'text-xs px-2.5 py-1 rounded-full border transition disabled:opacity-40 ' +
                        (tab === t.key ? 'border-brand-green text-brand-ink bg-brand-tint' : 'border-brand-line text-brand-muted hover:text-brand-ink')
                      }
                    >
                      {t.label}{n > 0 && <span className="font-mono ml-1">{n}</span>}
                    </button>
                  );
                })}
              </div>
              {shown.length
                ? <TalkingPoints points={shown} />
                : <p className="text-sm text-brand-muted">No talking points{tab !== 'all' ? ' in this view' : ' yet'}.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
