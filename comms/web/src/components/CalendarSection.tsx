import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, Clock, ArrowUpRight, Check, BellOff, X, Plus,
  ChevronLeft, ChevronRight, AlertTriangle, TrendingUp, Loader2, CircleHelp, Repeat,
} from 'lucide-react';
import {
  api, type ClientProfile, type CalendarEvent, type CalendarScanResult, type ReportInputs, type CalendarKind,
} from '../lib/api';
import { getMeters, meterLabel } from '../lib/clientProfile';
import { useBackgroundTasks } from '../workspace/BackgroundTasksContext';
import {
  parseContractEnd, renewalWindowOpen, consumptionKwh, monthMatrix, dueLabel, startOfDay, addDays,
  addMonths, dayKey, sameDay, isOverdue, formatMonthYear, formatDayMonth, formatKwh, MONTHS_SHORT,
} from '../lib/calendarDates';

// The Calendar — a projection of facts already in the CRM, never a manual diary.
// Two engines feed it: detected commitments mined from the client timeline (stored
// rows, provenance-backed) and live-computed contract-end / renewal-window markers
// derived deterministically from each meter's contractEnd (no model, always fresh).
// Scoped to one client on a client tab, or the whole book on the Free tab.

type CalItemKind = CalendarKind | 'contract-end' | 'renewal-window';

interface CalItem {
  id: string;
  kind: CalItemKind;
  origin: 'detected' | 'manual' | 'renewal';
  title: string;
  date: Date;
  allDay: boolean;
  clientProfileId?: string;
  clientName?: string;
  detail?: string;        // verbatim quote (detected) or "Meter · Supplier" (renewal)
  confidence?: 'high' | 'medium' | 'low' | null;
  consumptionKwh?: number;
  inferredYear?: boolean;
  stored?: CalendarEvent; // back-reference for actions (detected/manual only)
}

const KIND: Record<CalItemKind, { label: string; dot: string; text: string; soft: string }> = {
  callback: { label: 'Callback', dot: 'bg-brand-green', text: 'text-brand-greenDark', soft: 'bg-brand-tint' },
  deadline: { label: 'Client due', dot: 'bg-amber-500', text: 'text-amber-700', soft: 'bg-amber-50' },
  'our-action': { label: 'Our action', dot: 'bg-sky-500', text: 'text-sky-700', soft: 'bg-sky-50' },
  manual: { label: 'Reminder', dot: 'bg-slate-400', text: 'text-slate-600', soft: 'bg-slate-50' },
  'contract-end': { label: 'Contract end', dot: 'bg-violet-500', text: 'text-violet-700', soft: 'bg-violet-50' },
  'renewal-window': { label: 'Re-tender', dot: 'bg-violet-400', text: 'text-violet-600', soft: 'bg-violet-50' },
};
const ACTIONABLE = new Set<CalItemKind>(['callback', 'deadline', 'our-action', 'manual', 'renewal-window']);

// Auto-scan dedupe that survives remounts AND task-tray pruning: the section is
// keyed by client (so it remounts on switch) and bg tasks can be cleared/dismissed,
// so a per-mount ref or bg.latestFor alone would re-fire the scan on every revisit.
// One scan per client per page-load; a reload clears this to pick up new activity.
const scannedClients = new Set<string>();

// A snoozed event is hidden until its wake time; afterwards it behaves as open.
function effectiveStatus(ev: CalendarEvent | undefined, now: Date): CalendarEvent['status'] | 'open' {
  if (!ev) return 'open';
  if (ev.status === 'snoozed') return ev.snoozedUntil && new Date(ev.snoozedUntil) > now ? 'snoozed' : 'open';
  return ev.status;
}

export function CalendarSection({ clientId, onOpenClient }: {
  clientId?: string;
  onOpenClient: (id: string, name?: string) => void;
}) {
  const [view, setView] = useState<'today' | 'month' | 'year'>('today');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const bg = useBackgroundTasks();
  // `now` ticks so the Today/Overdue grouping, due labels and snooze-expiry stay
  // live if the tab is left open across midnight (the section isn't remounted then).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id); }, []);

  // Sequence the refetch so a stale in-flight list() (e.g. from the scan-done
  // effect) can't land after a newer one and clobber an optimistic update.
  const loadSeq = useRef(0);
  const loadEvents = useCallback(() => {
    const token = ++loadSeq.current;
    return api.calendar.list(clientId).then((es) => { if (token === loadSeq.current) setEvents(es); }).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.profiles.list(), api.calendar.list(clientId)])
      .then(([cs, es]) => { if (!alive) return; setClients(cs); setEvents(es); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [clientId]);

  // Auto-scan the active client's timeline ONCE per session — no manual trigger.
  // Runs as a background task so it survives navigation; the guard reflects an
  // existing run so remounting the section doesn't re-fire it.
  useEffect(() => {
    if (!clientId || scannedClients.has(clientId) || !clients.length) return;
    if (bg.latestFor(clientId, 'calendar')) { scannedClients.add(clientId); return; }
    scannedClients.add(clientId);
    const c = clients.find((x) => x.id === clientId);
    bg.run<CalendarScanResult>({
      kind: 'calendar',
      label: `Calendar — ${c?.name ?? 'client'}`,
      clientId,
      clientName: c?.name,
      fn: () => api.calendar.scan(clientId),
    });
  }, [clientId, clients, bg]);

  const scanTask = clientId ? bg.latestFor(clientId, 'calendar') : undefined;
  const scanning = scanTask?.status === 'running';
  useEffect(() => { if (scanTask?.status === 'done') loadEvents(); }, [scanTask?.id, scanTask?.status, loadEvents]);

  // ── unified item model: stored detected/manual events + live renewal markers ──
  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = [];
    const visible = clientId ? clients.filter((c) => c.id === clientId) : clients;

    for (const ev of events) {
      const eff = effectiveStatus(ev, now);
      if (eff === 'dismissed') continue; // tombstone — never shown
      const c = clients.find((x) => x.id === ev.clientProfileId);
      out.push({
        id: ev.id, kind: ev.kind, origin: ev.origin, title: ev.title, date: new Date(ev.start), allDay: ev.allDay,
        clientProfileId: ev.clientProfileId ?? undefined, clientName: c?.name, detail: ev.source ?? undefined,
        confidence: ev.confidence, stored: ev,
      });
    }

    for (const c of visible) {
      if (c.stage === 'lost') continue; // dead leads don't renew
      const inputs = c.inputs as ReportInputs;
      const meters = getMeters(inputs);
      const metered = meters.filter((m) => (m.contractEnd ?? '').trim());
      const sources = metered.length
        ? metered.map((m, i) => ({ raw: m.contractEnd as string, label: meterLabel(m), supplier: m.supplier, kwh: consumptionKwh(m.consumption) ?? consumptionKwh(m.dayConsumption), key: `m${i}` }))
        : ((inputs.contractEnd ?? '').trim()
            ? [{ raw: inputs.contractEnd as string, label: 'Contract', supplier: inputs.currentSupplier, kwh: consumptionKwh(inputs.consumption), key: 'top' }]
            : []);
      for (const s of sources) {
        const p = parseContractEnd(s.raw, now);
        if (!p.ok) continue; // unparseable surfaces in the yearly "needs a date" tray
        const detail = [s.label, s.supplier].filter(Boolean).join(' · ');
        out.push({ id: `ce:${c.id}:${s.key}`, kind: 'contract-end', origin: 'renewal', title: `${c.name} — contract ends`, date: p.date, allDay: true, clientProfileId: c.id, clientName: c.name, detail, consumptionKwh: s.kwh ?? undefined, inferredYear: p.inferredYear, confidence: p.confidence });
        // A re-tender nudge only matters while the contract is still live — skip the
        // renewal window for already-expired contracts (avoids "547d overdue" noise).
        if (p.date >= startOfDay(now)) {
          out.push({ id: `rw:${c.id}:${s.key}`, kind: 'renewal-window', origin: 'renewal', title: `${c.name} — start re-tender`, date: renewalWindowOpen(p.date), allDay: true, clientProfileId: c.id, clientName: c.name, detail, consumptionKwh: s.kwh ?? undefined, inferredYear: p.inferredYear, confidence: p.confidence });
        }
      }
    }
    return out;
  }, [events, clients, clientId, now]);

  // ── actions on stored events ──
  const patchEvent = useCallback(async (ev: CalendarEvent | undefined, patch: Parameters<typeof api.calendar.update>[1]) => {
    if (!ev) return;
    setEvents((list) => list.map((e) => (e.id === ev.id ? { ...e, ...patch } : e))); // optimistic
    await api.calendar.update(ev.id, patch).catch(() => {});
    loadEvents();
  }, [loadEvents]);
  const removeEvent = useCallback(async (ev: CalendarEvent | undefined) => {
    if (!ev) return;
    setEvents((list) => list.filter((e) => e.id !== ev.id));
    await api.calendar.remove(ev.id).catch(() => {});
    loadEvents();
  }, [loadEvents]);

  const clientName = clientId ? clients.find((c) => c.id === clientId)?.name : undefined;

  return (
    <div className="space-y-4">
      {/* Header + view switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-brand-tint flex items-center justify-center shrink-0">
            <CalendarDays size={18} className="text-brand-greenDark" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight truncate">Calendar</h1>
            <p className="text-xs text-brand-muted truncate">
              {clientName ? `${clientName} — commitments & renewal` : 'Commitments & renewals across your book'}
              {scanning && <span className="inline-flex items-center gap-1 ml-2 text-brand-greenDark"><Loader2 size={11} className="animate-spin" /> reading timeline…</span>}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-brand-line bg-white p-0.5">
            {(['today', 'month', 'year'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={'px-3 py-1.5 text-sm font-medium rounded-md transition ' + (view === v ? 'bg-brand-tint text-brand-greenDark' : 'text-brand-muted hover:text-brand-ink')}>
                {v === 'today' ? 'Today' : v === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>
          <button className="btn-ghost" onClick={() => setAdding(true)}><Plus size={15} /> Add</button>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-brand-muted">Loading calendar…</div>
      ) : view === 'today' ? (
        <DayAgenda items={items} now={now} onOpenClient={onOpenClient} onDone={(it) => patchEvent(it.stored, { status: 'done' })}
          onSnooze={(it) => patchEvent(it.stored, { status: 'snoozed', snoozedUntil: addDays(startOfDay(now), 7).toISOString() })}
          onDismiss={(it) => removeEvent(it.stored)} />
      ) : view === 'month' ? (
        <MonthView items={items} now={now} onOpenClient={onOpenClient} />
      ) : (
        <YearlyRenewals clients={clientId ? clients.filter((c) => c.id === clientId) : clients} items={items} now={now} onOpenClient={onOpenClient} />
      )}

      {adding && (
        <AddEventModal clients={clients} defaultClientId={clientId} onClose={() => setAdding(false)}
          onCreated={() => { setAdding(false); loadEvents(); }} />
      )}
    </div>
  );
}

// ── Today: overdue (pinned) + today + the next 7 days ──
function DayAgenda({ items, now, onOpenClient, onDone, onSnooze, onDismiss }: {
  items: CalItem[]; now: Date;
  onOpenClient: (id: string, name?: string) => void;
  onDone: (it: CalItem) => void; onSnooze: (it: CalItem) => void; onDismiss: (it: CalItem) => void;
}) {
  const live = items.filter((it) => ACTIONABLE.has(it.kind) && effectiveStatus(it.stored, now) === 'open');
  const today = startOfDay(now);
  const overdue = live.filter((it) => isOverdue(it.date.toISOString(), now)).sort((a, b) => a.date.getTime() - b.date.getTime());
  const todays = live.filter((it) => sameDay(it.date, now)).sort((a, b) => a.date.getTime() - b.date.getTime());
  const horizon = addDays(today, 8);
  const upcoming = live.filter((it) => it.date >= addDays(today, 1) && it.date < horizon).sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {overdue.length > 0 && (
          <Group title="Overdue" tone="amber" count={overdue.length}>
            {overdue.map((it) => <Row key={it.id} it={it} now={now} onOpenClient={onOpenClient} onDone={onDone} onSnooze={onSnooze} onDismiss={onDismiss} />)}
          </Group>
        )}
        <Group title="Today" count={todays.length}>
          {todays.length ? todays.map((it) => <Row key={it.id} it={it} now={now} onOpenClient={onOpenClient} onDone={onDone} onSnooze={onSnooze} onDismiss={onDismiss} />)
            : <p className="text-sm text-brand-muted px-1 py-2">Nothing due today. {overdue.length ? 'Clear the overdue items above.' : 'You’re on top of it.'}</p>}
        </Group>
      </div>
      <div className="space-y-4">
        <Group title="Next 7 days" count={upcoming.length}>
          {upcoming.length ? upcoming.map((it) => <Row key={it.id} it={it} now={now} compact onOpenClient={onOpenClient} onDone={onDone} onSnooze={onSnooze} onDismiss={onDismiss} />)
            : <p className="text-sm text-brand-muted px-1 py-2">A clear week ahead.</p>}
        </Group>
      </div>
    </div>
  );
}

function Group({ title, count, tone, children }: { title: string; count?: number; tone?: 'amber'; children: React.ReactNode }) {
  return (
    <div className={'card p-4 ' + (tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : '')}>
      <div className="flex items-center gap-2 mb-2">
        <h2 className={'text-sm font-semibold ' + (tone === 'amber' ? 'text-amber-700' : 'text-brand-ink')}>{title}</h2>
        {count !== undefined && <span className="text-[11px] text-brand-muted">{count}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ it, now, compact, onOpenClient, onDone, onSnooze, onDismiss }: {
  it: CalItem; now: Date; compact?: boolean;
  onOpenClient: (id: string, name?: string) => void;
  onDone: (it: CalItem) => void; onSnooze: (it: CalItem) => void; onDismiss: (it: CalItem) => void;
}) {
  const k = KIND[it.kind];
  const isStored = Boolean(it.stored);
  return (
    <div className="group flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-brand-surface transition">
      <span className={'mt-1.5 h-2 w-2 rounded-full shrink-0 ' + k.dot} title={k.label} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-brand-ink truncate">{it.title}</span>
          <span className={'text-[10px] px-1.5 py-0.5 rounded-full font-medium ' + k.soft + ' ' + k.text}>{k.label}</span>
          {it.confidence === 'low' && <span className="text-[10px] text-brand-muted" title="Low-confidence detection — verify before acting">· unverified</span>}
        </div>
        {it.detail && <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{it.origin === 'detected' ? `“${it.detail}”` : it.detail}</p>}
        <div className="flex items-center gap-2 mt-1">
          <span className={'text-[11px] font-medium ' + (isOverdue(it.date.toISOString(), now) ? 'text-amber-600' : 'text-brand-muted')}>
            {dueLabel(it.date.toISOString(), it.allDay, now)}
          </span>
          {it.clientProfileId && !compact && (
            <button onClick={() => onOpenClient(it.clientProfileId!, it.clientName)} className="text-[11px] text-brand-greenDark hover:underline inline-flex items-center gap-0.5">
              {it.clientName ?? 'client'} <ArrowUpRight size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
        {isStored && <IconBtn title="Mark done" onClick={() => onDone(it)}><Check size={15} /></IconBtn>}
        {isStored && <IconBtn title="Snooze 7 days" onClick={() => onSnooze(it)}><BellOff size={15} /></IconBtn>}
        {isStored ? <IconBtn title="Dismiss" onClick={() => onDismiss(it)}><X size={15} /></IconBtn>
          : it.clientProfileId && <IconBtn title="Open client" onClick={() => onOpenClient(it.clientProfileId!, it.clientName)}><ArrowUpRight size={15} /></IconBtn>}
      </div>
    </div>
  );
}

const IconBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button title={title} onClick={onClick} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-brand-muted hover:text-brand-ink hover:bg-brand-line/60 transition">{children}</button>
);

// ── Month grid ──
function MonthView({ items, now, onOpenClient }: { items: CalItem[]; now: Date; onOpenClient: (id: string, name?: string) => void }) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [selected, setSelected] = useState<Date | null>(null);
  const weeks = useMemo(() => monthMatrix(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const it of items) {
      if (it.stored && (effectiveStatus(it.stored, now) === 'done' || effectiveStatus(it.stored, now) === 'snoozed')) continue;
      const key = dayKey(it.date);
      (m.get(key) ?? m.set(key, []).get(key)!).push(it);
    }
    return m;
  }, [items, now]);
  const selectedItems = selected ? (byDay.get(dayKey(selected)) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime()) : [];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">{formatMonthYear(cursor)}</h2>
          <div className="flex items-center gap-1">
            <IconBtn title="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))}><ChevronLeft size={16} /></IconBtn>
            <button className="text-[11px] text-brand-muted px-2 hover:text-brand-ink" onClick={() => setCursor(startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)))}>Today</button>
            <IconBtn title="Next month" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight size={16} /></IconBtn>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wide text-brand-muted mb-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-1 py-0.5 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((d) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayItems = byDay.get(dayKey(d)) ?? [];
            const isSel = selected && sameDay(d, selected);
            return (
              <button key={d.toISOString()} onClick={() => setSelected(d)}
                className={'min-h-[68px] rounded-lg border p-1 text-left transition ' +
                  (isSel ? 'border-brand-green ring-1 ring-brand-green/30 ' : 'border-brand-line hover:bg-brand-surface ') +
                  (inMonth ? 'bg-white ' : 'bg-brand-surface/50 ')}>
                <div className={'text-[11px] font-medium ' + (sameDay(d, now) ? 'text-brand-greenDark' : inMonth ? 'text-brand-ink' : 'text-brand-muted/60')}>
                  {sameDay(d, now) ? <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand-green text-white">{d.getDate()}</span> : d.getDate()}
                </div>
                <div className="mt-1 space-y-0.5">
                  {dayItems.slice(0, 3).map((it) => (
                    <div key={it.id} className={'flex items-center gap-1 ' + KIND[it.kind].text}>
                      <span className={'h-1.5 w-1.5 rounded-full shrink-0 ' + KIND[it.kind].dot} />
                      <span className="text-[10px] truncate">{it.clientName ?? it.title}</span>
                    </div>
                  ))}
                  {dayItems.length > 3 && <div className="text-[10px] text-brand-muted pl-2.5">+{dayItems.length - 3}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="card p-4">
        <h2 className="text-sm font-semibold mb-2">{selected ? formatDayMonth(selected) : 'Select a day'}</h2>
        {selected && selectedItems.length === 0 && <p className="text-sm text-brand-muted">Nothing scheduled.</p>}
        <div className="space-y-2">
          {selectedItems.map((it) => (
            <div key={it.id} className="flex items-start gap-2">
              <span className={'mt-1.5 h-2 w-2 rounded-full shrink-0 ' + KIND[it.kind].dot} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-brand-ink truncate">{it.title}</div>
                {it.detail && <div className="text-xs text-brand-muted line-clamp-2">{it.origin === 'detected' ? `“${it.detail}”` : it.detail}</div>}
                <div className="text-[11px] text-brand-muted mt-0.5">
                  {!it.allDay && it.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · '}{KIND[it.kind].label}
                  {it.clientProfileId && <> · <button onClick={() => onOpenClient(it.clientProfileId!, it.clientName)} className="text-brand-greenDark hover:underline">open</button></>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Yearly renewal windows — the strategic view + value-at-risk ──
function YearlyRenewals({ clients, items, now, onOpenClient }: {
  clients: ClientProfile[]; items: CalItem[]; now: Date;
  onOpenClient: (id: string, name?: string) => void;
}) {
  const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = addMonths(start, 12);
  const ends = items.filter((it) => it.kind === 'contract-end' && it.date >= start && it.date < end);
  const valueAtRisk = ends.reduce((sum, it) => sum + (it.consumptionKwh ?? 0), 0);

  // group contract-ends by month bucket
  const months: { label: string; date: Date; items: CalItem[] }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = addMonths(start, i);
    const bucket = ends.filter((it) => it.date.getFullYear() === d.getFullYear() && it.date.getMonth() === d.getMonth())
      .sort((a, b) => (b.consumptionKwh ?? 0) - (a.consumptionKwh ?? 0));
    months.push({ label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`, date: d, items: bucket });
  }

  // "needs a date" tray — non-empty contractEnd strings we could not parse
  const needsDate = useMemo(() => {
    const rows: { clientId: string; clientName: string; label: string; raw: string }[] = [];
    for (const c of clients) {
      if (c.stage === 'lost') continue;
      const inputs = c.inputs as ReportInputs;
      const meters = getMeters(inputs);
      const metered = meters.filter((m) => (m.contractEnd ?? '').trim());
      const srcs = metered.length
        ? metered.map((m) => ({ raw: m.contractEnd as string, label: meterLabel(m) }))
        : ((inputs.contractEnd ?? '').trim() ? [{ raw: inputs.contractEnd as string, label: 'Contract' }] : []);
      for (const s of srcs) if (!parseContractEnd(s.raw, now).ok) rows.push({ clientId: c.id, clientName: c.name, label: s.label, raw: s.raw });
    }
    return rows;
  }, [clients, now]);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4 sm:col-span-2 flex items-center gap-4">
          <div className="h-11 w-11 rounded-lg bg-brand-tint flex items-center justify-center shrink-0"><TrendingUp size={20} className="text-brand-greenDark" /></div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-brand-muted">Renewal volume — next 12 months</div>
            <div className="text-2xl font-semibold text-brand-ink">{valueAtRisk ? formatKwh(valueAtRisk) : '—'}</div>
            <div className="text-xs text-brand-muted">{ends.length} contract{ends.length === 1 ? '' : 's'} ending across {new Set(ends.map((e) => e.clientProfileId)).size} client{new Set(ends.map((e) => e.clientProfileId)).size === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wide text-brand-muted flex items-center gap-1"><CircleHelp size={12} /> Missing dates</div>
          <div className="text-2xl font-semibold text-brand-ink">{needsDate.length}</div>
          <div className="text-xs text-brand-muted">supply points need a renewal date</div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3 text-xs text-brand-muted">
          <Repeat size={13} /> <span>Contract ends laid out across the year — re-tender opens ~6 months ahead. Sized by volume.</span>
        </div>
        <div className="space-y-1.5">
          {months.map((m) => (
            <div key={m.label} className="flex items-start gap-3">
              <div className={'w-16 shrink-0 text-xs font-medium pt-1.5 ' + (m.date.getMonth() === now.getMonth() && m.date.getFullYear() === now.getFullYear() ? 'text-brand-greenDark' : 'text-brand-muted')}>{m.label}</div>
              <div className="flex-1 min-w-0 border-l border-brand-line pl-3 py-1 min-h-[2rem]">
                {m.items.length === 0 ? <div className="h-6" /> : (
                  <div className="flex flex-wrap gap-1.5">
                    {m.items.map((it) => {
                      const big = (it.consumptionKwh ?? 0) >= 500_000;
                      return (
                        <button key={it.id} onClick={() => onOpenClient(it.clientProfileId!, it.clientName)} title={`${it.detail ?? ''}${it.consumptionKwh ? ' · ' + formatKwh(it.consumptionKwh) : ''}${it.inferredYear ? ' · year assumed' : ''}`}
                          className={'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs hover:border-brand-green hover:bg-brand-tint transition max-w-full ' + (big ? 'border-violet-300 bg-violet-50' : 'border-brand-line bg-white')}>
                          <span className={'h-2 w-2 rounded-full shrink-0 ' + (big ? 'bg-violet-500' : 'bg-violet-400')} />
                          <span className="font-medium text-brand-ink truncate">{it.clientName}</span>
                          {it.consumptionKwh ? <span className="text-brand-muted">{formatKwh(it.consumptionKwh)}</span> : null}
                          {it.inferredYear && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {needsDate.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><CircleHelp size={15} className="text-brand-muted" /> Needs a renewal date</h2>
          <p className="text-xs text-brand-muted mb-2">These supply points have a contract-end value we couldn’t read — add a clear date so they appear in the renewal plan.</p>
          <div className="flex flex-wrap gap-1.5">
            {needsDate.map((r, i) => (
              <button key={r.clientId + i} onClick={() => onOpenClient(r.clientId, r.clientName)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs hover:border-amber-400 transition">
                <span className="font-medium text-brand-ink">{r.clientName}</span>
                <span className="text-amber-700">“{r.raw}”</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Minimal manual add (the automatic engines do the rest) ──
function AddEventModal({ clients, defaultClientId, onClose, onCreated }: {
  clients: ClientProfile[]; defaultClientId?: string; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [kind, setKind] = useState<CalendarKind>('callback');
  const [client, setClient] = useState(defaultClientId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim() || !date) { setErr('A title and date are needed.'); return; }
    setBusy(true); setErr(null);
    const start = new Date(`${date}T${time || '09:00'}`).toISOString();
    try {
      await api.calendar.create({ title: title.trim(), start, allDay: !time, kind, clientProfileId: client || undefined });
      onCreated();
    } catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Add a reminder</h2>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-ink"><X size={18} /></button>
        </div>
        <div>
          <div className="label mb-1">What</div>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back about pricing" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><div className="label mb-1">Date</div><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><div className="label mb-1">Time (optional)</div><input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="label mb-1">Type</div>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CalendarKind)}>
              <option value="callback">Callback</option>
              <option value="deadline">Client due</option>
              <option value="our-action">Our action</option>
              <option value="manual">Reminder</option>
            </select>
          </div>
          <div>
            <div className="label mb-1">Client (optional)</div>
            <select className="input" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">— none —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="text-xs text-up flex items-center gap-1"><AlertTriangle size={12} /> {err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />} Add</button>
        </div>
      </div>
    </div>
  );
}
