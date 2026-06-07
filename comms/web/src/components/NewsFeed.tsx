import { useEffect, useState } from 'react';
import {
  ExternalLink, Bookmark, BookmarkCheck, Pin, PinOff, Trash2, Settings2, Plus, Rss, Link2, Loader2,
} from 'lucide-react';
import { api, type NewsItem, type SavedArticle, type Headline, type NewsFeedSource } from '../lib/api';

function ago(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

const TOPIC_LABEL: Record<string, string> = {
  geopolitics: 'Geopolitics', policy: 'Policy', renewables: 'Renewables',
  gas: 'Gas', power: 'Power', oil: 'Oil', macro: 'Macro', other: 'Other',
};

type Tab = 'live' | 'headlines' | 'library';
interface Displayable { id: string; title: string; source: string; url: string; summary?: string; topic?: string; publishedAt: string | null; }

export function NewsFeed() {
  const [tab, setTab] = useState<Tab>('live');
  const [topic, setTopic] = useState('all');
  const [live, setLive] = useState<NewsItem[]>([]);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [library, setLibrary] = useState<SavedArticle[]>([]);
  const [feeds, setFeeds] = useState<NewsFeedSource[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [manage, setManage] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);

  const reloadLib = () => api.savedArticles.list().then(setLibrary).catch(() => {});
  const reloadHl = () => api.headlines.list().then(setHeadlines).catch(() => {});
  const reloadFeeds = () => api.newsFeeds.list().then(setFeeds).catch(() => {});

  useEffect(() => {
    api.news(24).then(setLive).catch((e) => setErr(String(e.message)));
    api.newsTopics().then(setTopics).catch(() => {});
    reloadHl(); reloadLib(); reloadFeeds();
  }, []);

  const savedTitles = new Set(library.map((a) => a.title));
  const pinnedTitles = new Set(headlines.map((h) => h.title));
  const toInput = (i: Displayable) => ({ title: i.title, source: i.source, url: i.url, summary: i.summary ?? '', topic: i.topic, publishedAt: i.publishedAt });

  const save = async (i: Displayable) => { try { await api.savedArticles.save(toInput(i)); reloadLib(); } catch (e) { setErr(String((e as Error).message)); } };
  const pin = async (i: Displayable) => { try { await api.headlines.add(toInput(i)); reloadHl(); } catch (e) { setErr(String((e as Error).message)); } };
  const unsave = async (id: string) => { try { await api.savedArticles.remove(id); reloadLib(); } catch (e) { setErr(String((e as Error).message)); } };
  const unpin = async (id: string) => { try { await api.headlines.remove(id); reloadHl(); } catch (e) { setErr(String((e as Error).message)); } };
  const addByUrl = async () => {
    if (!urlInput.trim()) return;
    setAddingUrl(true); setErr(null);
    try { await api.savedArticles.fromUrl(urlInput.trim()); setUrlInput(''); reloadLib(); }
    catch (e) { setErr(String((e as Error).message)); }
    finally { setAddingUrl(false); }
  };

  const list: Displayable[] = tab === 'live' ? live.map((n) => ({ ...n, publishedAt: n.publishedAt }))
    : tab === 'headlines' ? headlines
    : library;
  const shown = topic === 'all' ? list : list.filter((i) => (i.topic || 'other') === topic);
  const present = new Set(list.map((i) => i.topic || 'other'));
  const tabCount = (t: Tab) => (t === 'live' ? live.length : t === 'headlines' ? headlines.length : library.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">News</h2>
        <div className="flex gap-1 ml-2">
          {(['live', 'headlines', 'library'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setTopic('all'); }}
              className={'text-sm px-3 py-1.5 rounded-lg border transition capitalize ' +
                (tab === t ? 'border-brand-green bg-brand-tint text-brand-ink' : 'border-brand-line text-brand-muted hover:text-brand-ink')}
            >
              {t === 'live' ? 'Live feed' : t}{tabCount(t) ? <span className="font-mono text-xs ml-1">{tabCount(t)}</span> : ''}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button className="btn-ghost !py-1.5" onClick={() => setManage((m) => !m)}><Settings2 size={15} /> Manage feeds</button>
      </div>

      {manage && <FeedsPanel feeds={feeds} onChange={reloadFeeds} onErr={setErr} />}

      {/* Topic filters */}
      <div className="flex flex-wrap gap-1.5">
        {['all', ...topics.filter((t) => present.has(t)), ...(present.has('other') ? ['other'] : [])].map((t) => (
          <button
            key={t}
            onClick={() => setTopic(t)}
            className={'text-xs px-2.5 py-1 rounded-full border transition ' +
              (topic === t ? 'border-brand-green bg-brand-tint text-brand-ink' : 'border-brand-line text-brand-muted hover:text-brand-ink')}
          >
            {t === 'all' ? 'All topics' : TOPIC_LABEL[t] ?? t}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-up">{err}</p>}

      {tab === 'library' && (
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <Link2 size={15} className="text-brand-green shrink-0" />
          <input
            className="input !py-1.5 flex-1 min-w-[220px] text-sm"
            placeholder="Paste an article URL to add to your library…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addByUrl(); }}
          />
          <button className="btn-ghost !py-1.5" onClick={addByUrl} disabled={addingUrl || !urlInput.trim()}>
            {addingUrl ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {shown.map((i) => (
          <li key={i.id} className="card p-4">
            <div className="flex items-center gap-2 text-[11px] text-brand-muted mb-1">
              <span className="font-medium text-brand-greenDark">{i.source || 'Source'}</span>
              {i.publishedAt && <><span>·</span><span>{ago(i.publishedAt)}</span></>}
              {i.topic && <span className="ml-auto text-[10px] uppercase tracking-wide bg-brand-tint text-brand-greenDark px-1.5 py-0.5 rounded">{TOPIC_LABEL[i.topic] ?? i.topic}</span>}
            </div>
            <a href={i.url || undefined} target="_blank" rel="noreferrer" className="text-[15px] font-medium hover:text-brand-green inline-flex items-start gap-1">
              {i.title}
              {i.url && <ExternalLink size={13} className="mt-1 shrink-0 text-brand-muted" />}
            </a>
            {i.summary && <p className="text-sm text-brand-muted mt-1 leading-snug">{i.summary}</p>}

            <div className="flex items-center gap-1.5 mt-2">
              {tab === 'library'
                ? <ActionBtn onClick={() => unsave(i.id)} icon={Trash2} label="Remove" danger />
                : savedTitles.has(i.title)
                  ? <ActionBtn icon={BookmarkCheck} label="Saved" active />
                  : <ActionBtn onClick={() => save(i)} icon={Bookmark} label="Save" />}
              {tab === 'headlines'
                ? <ActionBtn onClick={() => unpin(i.id)} icon={PinOff} label="Unpin" danger />
                : pinnedTitles.has(i.title)
                  ? <ActionBtn icon={Pin} label="Pinned" active />
                  : <ActionBtn onClick={() => pin(i)} icon={Pin} label="Pin headline" />}
            </div>
          </li>
        ))}
        {!shown.length && (
          <li className="card p-8 text-center text-brand-muted text-sm">
            {tab === 'library' ? 'No saved articles yet — Save articles from the Live feed to build your library.'
              : tab === 'headlines' ? 'No headlines pinned yet — Pin the big stories so they persist here.'
              : 'No articles in this view.'}
          </li>
        )}
      </ul>
    </div>
  );
}

function ActionBtn({ onClick, icon: Icon, label, active, danger }: { onClick?: () => void; icon: typeof Pin; label: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition ' +
        (active ? 'border-brand-green text-brand-greenDark bg-brand-tint'
          : danger ? 'border-brand-line text-brand-muted hover:text-up hover:border-up/40'
          : 'border-brand-line text-brand-muted hover:text-brand-ink hover:bg-brand-tint')}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function FeedsPanel({ feeds, onChange, onErr }: { feeds: NewsFeedSource[]; onChange: () => void; onErr: (s: string) => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try { await api.newsFeeds.add({ name: name.trim() || undefined, url: url.trim() }); setName(''); setUrl(''); onChange(); }
    catch (e) { onErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };
  const toggle = async (f: NewsFeedSource) => { try { await api.newsFeeds.setEnabled(f.id, !f.enabled); onChange(); } catch (e) { onErr(String((e as Error).message)); } };
  const remove = async (id: string) => { try { await api.newsFeeds.remove(id); onChange(); } catch (e) { onErr(String((e as Error).message)); } };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2"><Rss size={15} className="text-brand-green" /><h3 className="text-sm font-semibold">Sources</h3></div>
      <div className="space-y-1">
        {feeds.map((f) => (
          <div key={f.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-brand-green" checked={f.enabled} onChange={() => toggle(f)} />
            <span className={'flex-1 truncate ' + (f.enabled ? '' : 'text-brand-muted line-through')} title={f.url}>{f.name}</span>
            <span className="text-[11px] text-brand-muted/70 truncate max-w-[180px] hidden sm:inline">{f.url}</span>
            <button className="text-brand-muted hover:text-up shrink-0" onClick={() => remove(f.id)} title="Remove source"><Trash2 size={13} /></button>
          </div>
        ))}
        {!feeds.length && <p className="text-xs text-brand-muted">No sources yet.</p>}
      </div>
      <div className="flex flex-wrap gap-2 pt-1 border-t border-brand-line">
        <input className="input !py-1.5 !w-auto flex-1 min-w-[120px] text-sm" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input !py-1.5 flex-[2] min-w-[180px] text-sm" placeholder="https://… RSS / Atom URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn-ghost !py-1.5" onClick={add} disabled={busy || !url.trim()}><Plus size={15} /> Add</button>
      </div>
    </div>
  );
}
