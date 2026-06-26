import { useMemo, useState } from 'react';
import { Mail, Send, Sparkles, Loader2, Copy, Check, Reply, Inbox, PenLine } from 'lucide-react';
import { api, type ClientProfile, type ClientActivity, type ReportInputs, type EmailMsg, type ActivityType } from '../lib/api';
import { relativeTime } from '../lib/crm';

type LogActivity = (a: { type: ActivityType; title: string; detail?: string; meta?: Record<string, unknown> }) => Promise<ClientProfile | null>;

const msgOf = (a: ClientActivity): EmailMsg => ({
  direction: a.type === 'email-sent' ? 'out' : 'in',
  subject: (a.meta?.subject as string | undefined) ?? a.title,
  body: (a.meta?.body as string | undefined) ?? a.detail ?? a.title,
  at: a.at,
});

// Per-client email dialogue: the conversation history as a thread, plus AI-drafted
// next emails/replies grounded in the conversation + the client's talk-track angles.
export function EmailThread({ client, inputs, angles, logActivity }: {
  client: ClientProfile;
  inputs: ReportInputs;
  angles: string[];
  logActivity: LogActivity;
}) {
  // Oldest → newest, only the email activities.
  const thread = useMemo<EmailMsg[]>(
    () => [...client.activities].reverse().filter((a) => a.type === 'email-sent' || a.type === 'email-received').map(msgOf),
    [client.activities],
  );

  const [tab, setTab] = useState<'draft' | 'log'>('draft');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);
  // Log-received form
  const [inSubject, setInSubject] = useState('');
  const [inBody, setInBody] = useState('');

  const lastInbound = thread.length > 0 && thread[thread.length - 1].direction === 'in';

  const draft = async (mode: 'reply' | 'follow-up') => {
    setBusy(true); setErr(null);
    try {
      const res = await api.email.draft({ inputs, history: thread, mode, instruction: instruction.trim() || undefined, angles });
      if (res.error && res.provider !== 'claude' && res.provider !== 'openai') setErr(res.error);
      else { setSubject(res.subject); setBody(res.body); }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  const copyDraft = async () => {
    try { await navigator.clipboard.writeText((subject ? `Subject: ${subject}\n\n` : '') + body); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setErr('Couldn’t copy — select the text manually.'); }
  };

  const markSent = async () => {
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try {
      await logActivity({ type: 'email-sent', title: subject.trim() || 'Email sent', detail: body.trim(), meta: { email: true, direction: 'out', subject: subject.trim(), body: body.trim() } });
      setSubject(''); setBody(''); setInstruction('');
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  const logReceived = async () => {
    if (!inBody.trim()) return;
    setBusy(true); setErr(null);
    try {
      await logActivity({ type: 'email-received', title: inSubject.trim() || 'Received email', detail: inBody.trim(), meta: { email: true, direction: 'in', subject: inSubject.trim(), body: inBody.trim() } });
      setInSubject(''); setInBody('');
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
      {/* ── Thread ── */}
      <section className="card p-4 min-w-0">
        <div className="flex items-center gap-2 mb-3">
          <Mail size={15} className="text-brand-greenDark" />
          <h3 className="text-sm font-semibold">Email conversation</h3>
          <span className="text-[11px] text-brand-muted">{thread.length} message{thread.length === 1 ? '' : 's'}</span>
        </div>
        {thread.length === 0 ? (
          <p className="text-sm text-brand-muted py-6 text-center">No emails logged yet — draft the first one, or log one you’ve received.</p>
        ) : (
          <ol className="space-y-3">
            {thread.map((m, i) => {
              const out = m.direction === 'out';
              return (
                <li key={i} className={'flex ' + (out ? 'justify-end' : 'justify-start')}>
                  <div className={'max-w-[88%] rounded-xl px-3.5 py-2.5 border shadow-[0_4px_14px_-8px_rgba(43,42,46,0.4)] ' + (out ? 'bg-brand-tint border-brand-green/30' : 'bg-white border-brand-line')}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={'text-[10px] uppercase tracking-wide font-semibold ' + (out ? 'text-brand-greenDark' : 'text-brand-muted')}>{out ? 'Green Shift' : client.name}</span>
                      {m.at && <span className="text-[10px] text-brand-muted">· {relativeTime(m.at)}</span>}
                    </div>
                    {m.subject && <div className="text-[13px] font-medium text-brand-ink mb-0.5">{m.subject}</div>}
                    <p className="text-[13px] text-brand-ink whitespace-pre-line leading-relaxed">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ── Compose ── */}
      <section className="card p-4 lg:sticky lg:top-[calc(var(--topbar-h)+16px)]">
        <div className="inline-flex rounded-lg border border-brand-line bg-white p-0.5 text-sm mb-3">
          <button onClick={() => setTab('draft')} aria-pressed={tab === 'draft'} className={'px-3 py-1 rounded-md inline-flex items-center gap-1.5 transition ' + (tab === 'draft' ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted hover:text-brand-ink')}><Sparkles size={13} /> Draft next</button>
          <button onClick={() => setTab('log')} aria-pressed={tab === 'log'} className={'px-3 py-1 rounded-md inline-flex items-center gap-1.5 transition ' + (tab === 'log' ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted hover:text-brand-ink')}><Inbox size={13} /> Log received</button>
        </div>

        {tab === 'draft' ? (
          <div className="space-y-2.5">
            <p className="text-[11px] text-brand-muted">Generates the next email from the conversation above and this client’s talk-track angles.</p>
            <input className="input !py-1.5 text-sm" placeholder="Steer it (optional) — e.g. ‘attach the renewal numbers, propose a call’" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary !py-1.5 text-sm flex-1" onClick={() => draft(lastInbound ? 'reply' : 'follow-up')} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : lastInbound ? <Reply size={14} /> : <Sparkles size={14} />} {lastInbound ? 'Draft reply' : 'Draft follow-up'}
              </button>
              {lastInbound && (
                <button className="btn-ghost !py-1.5 text-sm" onClick={() => draft('follow-up')} disabled={busy} title="Draft a proactive follow-up instead">Follow-up</button>
              )}
            </div>

            {(subject || body) && (
              <div className="mt-1 space-y-2 border-t border-brand-line pt-3">
                <div>
                  <label className="label block mb-1">Subject</label>
                  <input className="input !py-1.5 text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div>
                  <label className="label block mb-1">Body</label>
                  <textarea className="input min-h-[200px] text-sm leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost !py-1.5 text-sm" onClick={copyDraft}>{copied ? <Check size={14} className="text-brand-green" /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
                  <button className="btn-primary !py-1.5 text-sm ml-auto" onClick={markSent} disabled={busy || !body.trim()}><Send size={14} /> Mark as sent</button>
                </div>
                <p className="text-[11px] text-brand-muted">Review &amp; edit before sending. “Mark as sent” adds it to the thread + timeline.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[11px] text-brand-muted">Paste an email you received — it’s added to the thread so future drafts respond in context.</p>
            <div>
              <label className="label block mb-1 flex items-center gap-1"><PenLine size={11} /> Subject</label>
              <input className="input !py-1.5 text-sm" placeholder="Re: energy renewal" value={inSubject} onChange={(e) => setInSubject(e.target.value)} />
            </div>
            <div>
              <label className="label block mb-1">Email body</label>
              <textarea className="input min-h-[160px] text-sm" placeholder="Paste the received email here…" value={inBody} onChange={(e) => setInBody(e.target.value)} />
            </div>
            <button className="btn-primary w-full !py-1.5 text-sm" onClick={logReceived} disabled={busy || !inBody.trim()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Inbox size={14} />} Log received email</button>
          </div>
        )}
        {err && <p className="text-sm text-up mt-2">{err}</p>}
      </section>
    </div>
  );
}
