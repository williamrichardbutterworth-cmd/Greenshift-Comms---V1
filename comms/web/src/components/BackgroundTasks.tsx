import { useEffect, useRef, useState } from 'react';
import { Loader2, Activity, Check, AlertCircle, X, ArrowUpRight, ListChecks } from 'lucide-react';
import { useBackgroundTasks, type BgTask } from '../workspace/BackgroundTasksContext';
import { relativeTime } from '../lib/crm';

const StatusIcon = ({ t, size = 14 }: { t: BgTask; size?: number }) =>
  t.status === 'running' ? <Loader2 size={size} className="animate-spin text-brand-green shrink-0" />
    : t.status === 'error' ? <AlertCircle size={size} className="text-up shrink-0" />
    : <Check size={size} className="text-brand-green shrink-0" />;

// Top-bar activity button → a dropdown tray of background tasks.
export function BackgroundTasksIndicator() {
  const bg = useBackgroundTasks();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = () => { setOpen((v) => !v); if (!open) bg.markAllSeen(); };
  const idle = bg.running === 0 && bg.tasks.length === 0;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={toggle}
        title="Background activity"
        aria-label="Background activity"
        className={'relative flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-sm font-medium transition ' + (open ? 'bg-brand-tint text-brand-greenDark' : 'text-brand-muted hover:text-brand-ink hover:bg-brand-surface')}
      >
        {bg.running > 0 ? <Loader2 size={15} className="animate-spin text-brand-green" /> : <Activity size={15} />}
        {bg.running > 0 && <span className="text-brand-greenDark">{bg.running}</span>}
        {bg.running === 0 && bg.unseen > 0 && <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-brand-green" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-80 max-h-[70vh] overflow-auto card p-0 shadow-soft z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-brand-line sticky top-0 bg-white">
            <span className="text-sm font-semibold flex items-center gap-1.5"><ListChecks size={14} className="text-brand-greenDark" /> Background activity</span>
            {bg.tasks.some((t) => t.status !== 'running') && (
              <button className="text-[11px] text-brand-muted hover:text-brand-ink" onClick={() => bg.clearDone()}>Clear done</button>
            )}
          </div>
          {idle ? (
            <p className="text-sm text-brand-muted px-3 py-6 text-center">Nothing running. Long jobs (bill analysis, uploads, automations) run here so you can keep working.</p>
          ) : (
            <ul className="divide-y divide-brand-line">
              {bg.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <span className="mt-0.5"><StatusIcon t={t} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-snug truncate" title={t.label}>{t.label}</div>
                    <div className="text-[11px] text-brand-muted truncate">
                      {t.clientName ? t.clientName + ' · ' : ''}
                      {t.status === 'running' ? 'Running…' : t.status === 'error' ? (t.error || 'Failed') : 'Done'}
                      {t.finishedAt ? ' · ' + relativeTime(new Date(t.finishedAt).toISOString()) : ''}
                    </div>
                  </div>
                  {t.status === 'done' && t.clientId && (
                    <button className="text-[11px] text-brand-greenDark hover:underline inline-flex items-center gap-0.5 shrink-0 mt-0.5" onClick={() => { bg.open(t); setOpen(false); }}>
                      Open <ArrowUpRight size={11} />
                    </button>
                  )}
                  {t.status !== 'running' && (
                    <button className="text-brand-muted/60 hover:text-up shrink-0 mt-0.5" title="Dismiss" onClick={() => bg.dismiss(t.id)}><X size={13} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Transient completion toasts (bottom-right), auto-dismissing after a few seconds.
export function BackgroundToasts() {
  const bg = useBackgroundTasks();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)] pointer-events-none">
      {bg.toasts.slice(0, 4).map((t) => <Toast key={t.id} task={t} onOpen={() => bg.open(t)} onClose={() => bg.dismissToast(t.id)} />)}
    </div>
  );
}

function Toast({ task, onOpen, onClose }: { task: BgTask; onOpen: () => void; onClose: () => void }) {
  const bg = useBackgroundTasks();
  // Arm the auto-dismiss exactly once per toast — depend only on stable values so a
  // sibling task starting/finishing (which re-renders this list) can't reset the clock.
  useEffect(() => {
    const h = setTimeout(() => bg.dismissToast(task.id), task.status === 'error' ? 9000 : 6500);
    return () => clearTimeout(h);
  }, [task.id, task.status, bg.dismissToast]);

  return (
    <div className="pointer-events-auto card p-3 shadow-soft flex items-start gap-2.5">
      <span className="mt-0.5"><StatusIcon t={task} size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug">{task.status === 'error' ? 'Couldn’t finish' : 'Ready'}{task.clientName ? ` — ${task.clientName}` : ''}</div>
        <div className="text-[12px] text-brand-muted leading-snug truncate" title={task.label}>{task.status === 'error' ? (task.error || task.label) : task.label}</div>
        {task.status === 'done' && task.clientId && (
          <button className="mt-1.5 text-[12px] font-medium text-brand-greenDark hover:underline inline-flex items-center gap-0.5" onClick={() => { onOpen(); onClose(); }}>
            Review <ArrowUpRight size={12} />
          </button>
        )}
      </div>
      <button className="text-brand-muted/60 hover:text-brand-ink shrink-0" title="Dismiss" onClick={onClose}><X size={14} /></button>
    </div>
  );
}
