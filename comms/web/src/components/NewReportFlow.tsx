import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, FileSpreadsheet, Sparkles } from 'lucide-react';
import { api, type ClientProfile, type ReportProject, type ReportInputs } from '../lib/api';
import { REPORT_TEMPLATES, getReportTemplate } from '../reports/registry';
import { newProjectFromState } from '../reports/state';
import { getField, getMeters } from '../lib/clientProfile';
import type { ReportTemplate } from '../reports/types';

// Recommend a report type from what we hold about the client — meters/sites drive a cost
// comparison; otherwise current-position or contract timing point to the best fit.
function recommendTemplate(client: ClientProfile | null): { id: string; reason: string } | null {
  if (!client) return null;
  const inputs = client.inputs as ReportInputs;
  const meters = getMeters(inputs);
  if (meters.length) {
    const sites = new Set(meters.map((m) => (m.siteAddress ?? '').trim().toLowerCase()).filter(Boolean)).size || 1;
    return { id: 'cost-comparison', reason: `${meters.length} meter${meters.length === 1 ? '' : 's'} across ${sites} site${sites === 1 ? '' : 's'} on file — we’ll build the comparison from them.` };
  }
  if (getField(inputs, 'currentSupplier') && getField(inputs, 'consumption')) {
    return { id: 'cost-comparison', reason: 'Current supplier + usage on file — ready for a like-for-like comparison.' };
  }
  const end = getField(inputs, 'contractEnd');
  if (end) return { id: 'procure-ahead', reason: `Contract end on file (${end}) — a procure-ahead market brief suits the timing.` };
  return null;
}

// A request to start a new report. `templateId` preselects the template;
// `profileId` is the client it's for (the active client tab). (seedAngles kept for
// call-site compatibility.)
export interface NewDocRequest { profileId?: string; templateId?: string; seedAngles?: string[] }

// The "new report" flow: ONE step — pick a template; the report is created for the
// active client (request.profileId), so there's no "who is this for?" selector.
// A preselected templateId creates immediately and skips the picker entirely.
export function NewReportFlow({ request, onCreated, onCancel }: {
  request: NewDocRequest | null;
  onCreated: (p: ReportProject) => void;
  onCancel: () => void;
}) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // template id mid-create
  const [err, setErr] = useState<string | null>(null);
  const createdRef = useRef(false); // guard the auto-create effect against double-fire

  const create = async (tpl: ReportTemplate, c: ClientProfile | null) => {
    setCreating(tpl.id); setErr(null);
    try {
      const state = tpl.seed(c);
      // Bind the report to the tab it was created from even if the client fetch
      // failed (so it never lands orphaned on the Free tab).
      if (request?.profileId) state.clientProfileId = request.profileId;
      const project = await api.projects.create(newProjectFromState(state));
      onCreated(project);
    } catch { setCreating(null); setErr('Couldn’t create the report — please try again.'); }
  };

  // Resolve the client for the active request, then auto-create if a template was
  // preselected (e.g. "Draft follow-up" / "Generate this step" from the client hub).
  useEffect(() => {
    createdRef.current = false;
    if (!request) { setClient(null); setCreating(null); return; }
    let cancelled = false;
    (async () => {
      const c = request.profileId ? await api.profiles.get(request.profileId).catch(() => null) : null;
      if (cancelled) return;
      setClient(c);
      const tpl = request.templateId ? getReportTemplate(request.templateId) : undefined;
      if (tpl && !createdRef.current) { createdRef.current = true; await create(tpl, c); }
    })();
    return () => { cancelled = true; };
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const rec = useMemo(() => recommendTemplate(client), [client]);

  if (!request) return null;
  // A resolvable preselected template creates immediately — don't flash the picker.
  const preselected = request.templateId ? getReportTemplate(request.templateId) : undefined;
  if (preselected) {
    return (
      <div className="fixed inset-0 z-40 bg-brand-ink/40 grid place-items-center p-4" onClick={err ? onCancel : undefined}>
        <div className="card px-6 py-5 flex items-center gap-3 text-sm" onClick={(e) => e.stopPropagation()}>
          {err ? (
            <>
              <span className="text-up flex items-center gap-2"><X size={15} /> {err}</span>
              <button className="btn-ghost !py-1 ml-1" onClick={() => create(preselected, client)}>Retry</button>
              <button className="btn-ghost !py-1" onClick={onCancel}>Close</button>
            </>
          ) : (
            <span className="text-brand-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin text-brand-greenDark" /> Creating report…</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-brand-ink/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="card w-full max-w-xl max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">New report{client ? ` — ${client.name}` : ''}</h3>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel}><X size={16} /></button>
        </div>

        {rec && (
          <div className="mb-3 rounded-lg bg-brand-tint border border-brand-green/30 px-3 py-2 flex items-start gap-2">
            <Sparkles size={14} className="text-brand-greenDark mt-0.5 shrink-0" />
            <div className="text-[12px] text-brand-ink leading-snug">
              <b>Recommended: {getReportTemplate(rec.id)?.name ?? rec.id}.</b> {rec.reason}
            </div>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          {REPORT_TEMPLATES.map((t) => {
            const isRec = rec?.id === t.id;
            const busy = creating === t.id;
            return (
              <button key={t.id} disabled={!!creating} onClick={() => create(t, client)} className={'card p-4 text-left hover:shadow-md hover:border-brand-green/40 transition relative disabled:opacity-60 ' + (isRec ? 'ring-1 ring-brand-green/50 border-brand-green/40' : '')}>
                {isRec && <span className="absolute top-2.5 right-2.5 text-[9px] uppercase tracking-wide font-medium text-brand-greenDark bg-brand-tint px-1.5 py-0.5 rounded">Recommended</span>}
                <span className={'grid place-items-center h-9 w-9 rounded-lg bg-brand-tint mb-2 ' + t.accent}>{busy ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}</span>
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-brand-muted mt-1 leading-relaxed">{t.description}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
