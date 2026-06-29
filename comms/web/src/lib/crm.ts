import type { ClientStage, ActivityType, ClientActivity } from './api';

// Shared CRM vocabulary — pipeline stages, tracker milestones and activity
// metadata, used by the client hub and the client list.

// The client's "talk track": conversational angles gathered across all logged
// sources, newest first, de-duplicated. Shared by the client hub + the emails view.
export function gatherAngles(activities: ClientActivity[] | undefined, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of activities ?? []) {
    for (const ang of Array.isArray(a.meta?.angles) ? a.meta!.angles : []) {
      if (typeof ang !== 'string') continue;
      const t = ang.trim();
      const k = t.toLowerCase();
      if (t && !seen.has(k)) { seen.add(k); out.push(t); }
    }
    if (out.length >= limit) break;
  }
  return out;
}

export const STAGES: { key: ClientStage; label: string }[] = [
  { key: 'new', label: 'New lead' },
  { key: 'profiling', label: 'Profiling' },
  { key: 'loa', label: 'Authority (LOA)' },
  { key: 'data', label: 'Data gathering' },
  { key: 'tender', label: 'Tendering' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];
export const stageLabel = (s: string): string => STAGES.find((x) => x.key === s)?.label ?? s;
export const stageIndex = (s: string): number => STAGES.findIndex((x) => x.key === s);

// Tracker milestones (keys must match the server's MILESTONE_KEYS).
export const MILESTONES: { key: string; label: string }[] = [
  { key: 'billReceived', label: 'Bill received' },
  { key: 'loaSent', label: 'LOA sent' },
  { key: 'loaReturned', label: 'LOA returned' },
  { key: 'quotesGathered', label: 'Quotes gathered' },
  { key: 'proposalSent', label: 'Proposal sent' },
  { key: 'signed', label: 'Contract signed' },
];
export const milestoneLabel = (k: string): string => MILESTONES.find((m) => m.key === k)?.label ?? k;

// Quick-log activity buttons (manual logging in the hub).
export const QUICK_LOG: { type: ActivityType; label: string; milestone?: string }[] = [
  { type: 'email-sent', label: 'Email sent' },
  { type: 'email-received', label: 'Email received' },
  { type: 'milestone', label: 'LOA sent', milestone: 'loaSent' },
  { type: 'milestone', label: 'LOA returned', milestone: 'loaReturned' },
  { type: 'file', label: 'Bill received', milestone: 'billReceived' },
  { type: 'note', label: 'Note' },
];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note', transcript: 'Call', 'email-sent': 'Email sent', 'email-received': 'Email received',
  document: 'Document', file: 'File', stage: 'Stage', milestone: 'Milestone', recommendation: 'Recommendation',
};

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
