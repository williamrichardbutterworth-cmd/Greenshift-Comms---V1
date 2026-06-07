import { useEffect, useState } from 'react';
import { ChevronUp, Lightbulb, Sparkles, Trash2, Send } from 'lucide-react';
import { api, type Idea, type IdeaStatus, type IdeasMeta } from '../lib/api';

const STATUS_BADGE: Record<IdeaStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-brand-line/70 text-brand-muted' },
  considering: { label: 'Considering', cls: 'bg-amber-100 text-amber-700' },
  planned: { label: 'Planned', cls: 'bg-brand-tint text-brand-greenDark' },
  done: { label: 'Done', cls: 'bg-brand-green text-white' },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function IdeasBoard() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [meta, setMeta] = useState<IdeasMeta>({ categories: ['Other'], statuses: ['new', 'considering', 'planned', 'done'] });
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | IdeaStatus>('all');
  const [err, setErr] = useState<string | null>(null);

  // form
  const [author, setAuthor] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [category, setCategory] = useState('Other');
  const [posting, setPosting] = useState(false);

  // ai summary
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);

  const reload = () => api.ideas().then(setIdeas).catch((e) => setErr(String(e.message)));

  useEffect(() => {
    reload();
    api.ideasMeta().then((m) => { setMeta(m); setCategory(m.categories[0] ?? 'Other'); }).catch(() => {});
  }, []);

  const post = async () => {
    if (!title.trim()) return;
    setPosting(true);
    setErr(null);
    try {
      await api.addIdea({ author, title, details, reasoning, category });
      setTitle(''); setDetails(''); setReasoning(''); // keep name + category for the next one
      setSummary(null); // invalidate stale digest
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setPosting(false);
    }
  };

  const vote = async (id: string) => {
    if (voted.has(id)) return;
    setVoted((s) => new Set(s).add(id));
    try { await api.voteIdea(id); await reload(); } catch (e) { setErr(String((e as Error).message)); }
  };

  const changeStatus = async (id: string, status: IdeaStatus) => {
    try { await api.setIdeaStatus(id, status); await reload(); } catch (e) { setErr(String((e as Error).message)); }
  };

  const removeIdea = async (id: string) => {
    try { await api.deleteIdea(id); await reload(); } catch (e) { setErr(String((e as Error).message)); }
  };

  const summarise = async () => {
    setSummarising(true);
    setErr(null);
    try { setSummary((await api.ideasSummary()).summary); } catch (e) { setErr(String((e as Error).message)); } finally { setSummarising(false); }
  };

  const shown = filter === 'all' ? ideas : ideas.filter((i) => i.status === filter);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      {/* Left: submit an idea */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={18} className="text-brand-green" />
          <h2 className="text-lg font-semibold">Share an idea</h2>
        </div>
        <p className="text-sm text-brand-muted -mt-1">
          Suggest anything you'd like the app to do. Ideas are saved for the whole team and ranked by votes.
        </p>

        <div>
          <label className="label block mb-1">Your name</label>
          <input className="input" placeholder="Your name" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1">Idea *</label>
          <input className="input" placeholder="A short, clear title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1">Details</label>
          <textarea className="input min-h-[70px]" placeholder="What should it do? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1">Reasoning</label>
          <textarea className="input min-h-[70px]" placeholder="Why it would help / the problem it solves (optional)" value={reasoning} onChange={(e) => setReasoning(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {meta.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn-primary w-full" onClick={post} disabled={posting || !title.trim()}>
          <Send size={15} /> {posting ? 'Posting…' : 'Post idea'}
        </button>
      </div>

      {/* Right: list + AI digest */}
      <div className="space-y-4">
        {err && <p className="text-sm text-up">{err}</p>}

        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', ...meta.statuses] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={
                  'text-xs px-2.5 py-1 rounded-full border transition ' +
                  (filter === s ? 'border-brand-green text-brand-ink bg-brand-tint' : 'border-brand-line text-brand-muted hover:text-brand-ink')
                }
              >
                {s === 'all' ? `All (${ideas.length})` : STATUS_BADGE[s].label}
              </button>
            ))}
          </div>
          <button className="btn-ghost" onClick={summarise} disabled={summarising || !ideas.length}>
            <Sparkles size={15} /> {summarising ? 'Summarising…' : 'Summarise themes'}
          </button>
        </div>

        {summary && (
          <div className="card p-4 bg-brand-tint/60 border-brand-line">
            <div className="label mb-1 flex items-center gap-1.5"><Sparkles size={13} className="text-brand-greenDark" /> Roadmap digest</div>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-brand-ink">{summary}</pre>
          </div>
        )}

        {!shown.length && (
          <div className="card p-8 text-center text-brand-muted">
            <Lightbulb size={26} className="mx-auto mb-2 opacity-50" />
            {ideas.length ? 'No ideas in this view.' : 'No ideas yet — be the first to add one.'}
          </div>
        )}

        {shown.map((i) => (
          <div key={i.id} className="card p-4 flex gap-3">
            <button
              onClick={() => vote(i.id)}
              disabled={voted.has(i.id)}
              title={voted.has(i.id) ? 'Voted' : 'Upvote'}
              className={
                'shrink-0 flex flex-col items-center justify-center w-12 rounded-lg border transition ' +
                (voted.has(i.id) ? 'border-brand-green bg-brand-tint text-brand-greenDark' : 'border-brand-line text-brand-muted hover:border-brand-green hover:text-brand-green')
              }
            >
              <ChevronUp size={18} />
              <span className="font-mono text-sm font-semibold">{i.votes}</span>
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 flex-wrap">
                <h3 className="font-semibold text-brand-ink flex-1 min-w-0">{i.title}</h3>
                <span className={'text-[10px] px-2 py-0.5 rounded-full font-medium ' + STATUS_BADGE[i.status].cls}>{STATUS_BADGE[i.status].label}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-tint text-brand-greenDark">{i.category}</span>
              </div>
              <div className="text-xs text-brand-muted mt-0.5">{i.author} · {fmtDate(i.createdAt)}</div>
              {i.details && <p className="text-sm mt-2 leading-relaxed">{i.details}</p>}
              {i.reasoning && <p className="text-sm mt-1.5 text-brand-muted leading-relaxed"><span className="font-medium text-brand-ink">Why:</span> {i.reasoning}</p>}

              <div className="flex items-center gap-2 mt-3">
                <span className="label">Status</span>
                <select
                  className="input !py-1 !w-auto text-xs"
                  value={i.status}
                  onChange={(e) => changeStatus(i.id, e.target.value as IdeaStatus)}
                >
                  {meta.statuses.map((s) => <option key={s} value={s}>{STATUS_BADGE[s].label}</option>)}
                </select>
                <button className="btn-ghost !px-1.5 !py-1 hover:text-up ml-auto" onClick={() => removeIdea(i.id)} title="Delete idea"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
