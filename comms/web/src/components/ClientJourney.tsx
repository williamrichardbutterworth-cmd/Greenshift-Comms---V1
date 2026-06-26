import { useMemo } from 'react';
import {
  StickyNote, Phone, Mail, FileText, Paperclip, ArrowRightCircle, Flag, Sparkles, Wand2,
  Lightbulb, ExternalLink, Plus, Loader2, Check, MapPin,
} from 'lucide-react';
import type { ClientProfile, ClientActivity, ActivityType, NextStep } from '../lib/api';
import { STAGES, relativeTime, stageIndex } from '../lib/crm';

const STEP_ICON: Record<ActivityType, typeof StickyNote> = {
  note: StickyNote, transcript: Phone, 'email-sent': Mail, 'email-received': Mail,
  document: FileText, file: Paperclip, stage: ArrowRightCircle, milestone: Flag, recommendation: Sparkles,
};
// A little colour per step type so the flow reads at a glance.
const STEP_TONE: Partial<Record<ActivityType, string>> = {
  transcript: 'from-sky-50 text-sky-700 ring-sky-200',
  'email-sent': 'from-violet-50 text-violet-700 ring-violet-200',
  'email-received': 'from-violet-50 text-violet-700 ring-violet-200',
  document: 'from-brand-tint text-brand-greenDark ring-brand-green/30',
  milestone: 'from-amber-50 text-amber-700 ring-amber-200',
  recommendation: 'from-brand-tint text-brand-greenDark ring-brand-green/30',
};
const toneFor = (t: ActivityType) => STEP_TONE[t] ?? 'from-brand-surface text-brand-muted ring-brand-line';
const stringAngles = (meta: Record<string, unknown> | undefined): string[] =>
  Array.isArray(meta?.angles) ? (meta!.angles as unknown[]).filter((x): x is string => typeof x === 'string') : [];

// A per-client "journey" — a depth-styled flow map of the relationship built from
// the pipeline stage, the captured call ideas/angles, the activity timeline and the
// AI's recommended next step (which can be generated straight from the frontier).
export function ClientJourney({ client, next, nextLoading, angles, onStartDocument, onDraftFromAngles, onOpenProject }: {
  client: ClientProfile;
  next: NextStep | null;
  nextLoading: boolean;
  angles: string[];
  onStartDocument: (client: ClientProfile, templateId?: string) => void;
  onDraftFromAngles: (client: ClientProfile, angles: string[]) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const stageIdx = stageIndex(client.stage);
  const isLost = client.stage === 'lost';
  const railStages = useMemo(() => STAGES.filter((s) => s.key !== 'lost'), []);
  // Oldest → newest so the flow reads from the start of the journey down to "now".
  const steps = useMemo<ClientActivity[]>(() => [...client.activities].reverse(), [client.activities]);

  return (
    <div className="space-y-5">
      {/* ── Stage flow (the path) — depth-styled, future stages recede ── */}
      <section className="card p-5 overflow-x-auto">
        <div className="flex items-center gap-1.5 mb-4">
          <MapPin size={14} className="text-brand-greenDark" />
          <h3 className="text-sm font-semibold">Pipeline journey</h3>
          <span className="text-[11px] text-brand-muted">— where {client.name} is on the path to won</span>
        </div>
        <div className="flex items-stretch gap-1.5 min-w-max pb-1" style={{ perspective: '900px' }}>
          {railStages.map((s, i) => {
            const done = !isLost && i < stageIdx;
            const current = !isLost && i === stageIdx;
            const future = isLost || i > stageIdx;
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <div
                  className={
                    'relative rounded-xl px-3.5 py-2.5 border text-center transition-all ' +
                    (current
                      ? 'bg-gradient-to-b from-brand-green to-brand-greenDark text-white border-brand-greenDark shadow-[0_10px_24px_-8px_rgba(64,168,0,0.6)] scale-105 z-[1]'
                      : done
                        ? 'bg-brand-tint text-brand-greenDark border-brand-green/30 shadow-[0_6px_16px_-10px_rgba(43,42,46,0.4)]'
                        : 'bg-white text-brand-muted border-brand-line shadow-sm opacity-70')
                  }
                  style={future ? { transform: 'scale(0.94)' } : undefined}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {done && <Check size={13} />}
                    {current && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                    <span className="text-[13px] font-medium whitespace-nowrap">{s.label}</span>
                  </div>
                  <div className={'text-[9px] uppercase tracking-wide mt-0.5 ' + (current ? 'text-white/80' : 'text-brand-muted')}>
                    {done ? 'Done' : current ? 'Now' : `Step ${i + 1}`}
                  </div>
                </div>
                {i < railStages.length - 1 && (
                  <svg width="22" height="12" viewBox="0 0 22 12" className={done ? 'text-brand-green' : 'text-brand-line'}>
                    <path d="M0 6 H16 M12 2 L16 6 L12 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            );
          })}
          {isLost && <div className="self-center ml-2 text-[11px] px-2 py-1 rounded-full bg-up/10 text-up">Lost</div>}
        </div>
      </section>

      {/* ── Captured ideas (everything proposed on calls) ── */}
      {angles.length > 0 && (
        <section className="card p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="grid place-items-center h-6 w-6 rounded-lg bg-brand-green/10 text-brand-greenDark"><Lightbulb size={13} /></span>
            <h3 className="text-sm font-semibold">Captured ideas</h3>
            <span className="text-[11px] text-brand-muted hidden sm:inline">— picked up from your conversations</span>
            <button className="btn-ghost !py-1 !px-2 text-xs ml-auto shrink-0" onClick={() => onDraftFromAngles(client, angles)}>
              <Sparkles size={13} /> Draft follow-up
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {angles.map((a) => (
              <span key={a} className="text-[12px] leading-snug px-2.5 py-1.5 rounded-lg bg-brand-tint/70 border border-brand-line text-brand-ink shadow-[0_2px_6px_-3px_rgba(43,42,46,0.3)]">
                {a}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ── The journey flow (steps) ── */}
      <section className="card p-5">
        <h3 className="text-sm font-semibold mb-4">Journey so far</h3>
        {steps.length === 0 ? (
          <p className="text-sm text-brand-muted">No steps yet — log a call or update to start the journey.</p>
        ) : (
          <div className="relative pl-7">
            {/* the flowing spine */}
            <span className="absolute left-[11px] top-1 bottom-8 w-0.5 bg-gradient-to-b from-brand-green/50 via-brand-line to-brand-line rounded-full" aria-hidden />
            <ol className="space-y-3">
              {steps.map((a) => {
                const Icon = STEP_ICON[a.type] ?? StickyNote;
                const ideas = stringAngles(a.meta);
                const projectId = a.meta?.projectId ? String(a.meta.projectId) : null;
                return (
                  <li key={a.id} className="relative">
                    {/* raised node on the spine */}
                    <span className={'absolute -left-7 top-1.5 grid place-items-center h-[26px] w-[26px] rounded-full bg-gradient-to-b ring-2 ring-white shadow-[0_4px_10px_-3px_rgba(43,42,46,0.45)] z-[1] ' + toneFor(a.type)}>
                      <Icon size={13} />
                    </span>
                    <div className="rounded-xl border border-brand-line bg-white px-3.5 py-2.5 shadow-[0_6px_18px_-10px_rgba(43,42,46,0.4)] hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-10px_rgba(43,42,46,0.45)] transition-all">
                      <div className="flex items-baseline gap-2">
                        {projectId ? (
                          <button className="text-sm text-left font-medium text-brand-greenDark hover:underline" onClick={() => onOpenProject(projectId)}>
                            {a.title}<ExternalLink size={11} className="inline ml-1 -mt-0.5" />
                          </button>
                        ) : <span className="text-sm font-medium text-brand-ink">{a.title}</span>}
                        <span className="text-[11px] text-brand-muted ml-auto shrink-0">{relativeTime(a.at)}</span>
                      </div>
                      {a.detail && <p className="text-xs text-brand-muted mt-1 whitespace-pre-line leading-relaxed line-clamp-3">{a.detail}</p>}
                      {ideas.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ideas.map((idea) => (
                            <span key={idea} className="text-[10px] px-1.5 py-0.5 rounded bg-brand-tint text-brand-greenDark border border-brand-green/20 inline-flex items-center gap-1">
                              <Lightbulb size={9} /> {idea.length > 60 ? idea.slice(0, 58) + '…' : idea}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>

      {/* ── Frontier: the next step, ready to generate ── */}
      <section className="card p-5 bg-gradient-to-br from-brand-tint to-white ring-1 ring-brand-green/20 shadow-[0_14px_34px_-16px_rgba(64,168,0,0.5)]">
        <div className="flex items-center gap-2 mb-2">
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-brand-green text-white shadow-[0_6px_14px_-6px_rgba(64,168,0,0.7)]"><Sparkles size={15} /></span>
          <h3 className="text-sm font-semibold">The next step</h3>
        </div>
        {nextLoading ? (
          <p className="text-sm text-brand-muted">Working out the best next move…</p>
        ) : next?.action ? (
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-brand-ink">{next.action}</p>
              {next.rationale && <p className="text-[13px] text-brand-muted mt-1 leading-snug">{next.rationale}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {next.templateId ? (
                <button className="btn-primary" onClick={() => onStartDocument(client, next.templateId)}><Wand2 size={15} /> Generate this step</button>
              ) : (
                <button className="btn-primary" onClick={() => onStartDocument(client)}><Plus size={15} /> Add the next step</button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-brand-muted flex-1">{next?.provider === 'none' ? 'Recommendations need automatic drafting configured.' : 'Log some activity to get a recommended next step.'}</p>
            <button className="btn-ghost" onClick={() => onStartDocument(client)}><Plus size={15} /> Add a step</button>
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-brand-green/15 flex items-center gap-2">
          <span className="text-[11px] text-brand-muted">Or jump straight to a document:</span>
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => onStartDocument(client)}><Plus size={13} /> New document</button>
        </div>
      </section>
    </div>
  );
}
