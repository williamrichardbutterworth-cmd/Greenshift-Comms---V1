import { useEffect, useMemo, useState } from 'react';
import { X, Building2, ArrowLeft, Loader2, FileSpreadsheet } from 'lucide-react';
import { api, type ClientProfile, type ReportProject } from '../lib/api';
import { REPORT_TEMPLATES, getReportTemplate } from '../reports/registry';
import { newProjectFromState } from '../reports/state';
import type { ReportTemplate } from '../reports/types';

// A request to start a new report. `templateId` preselects the template;
// `profileId` preselects the client. (seedAngles kept for call-site compatibility.)
export interface NewDocRequest { profileId?: string; templateId?: string; seedAngles?: string[] }

// The "new report" flow: choose a template → choose the client → create. On success
// it returns the created project (which the workspace opens as a tab).
export function NewReportFlow({ request, onCreated, onCancel }: {
  request: NewDocRequest | null;
  onCreated: (p: ReportProject) => void;
  onCancel: () => void;
}) {
  const [tpl, setTpl] = useState<ReportTemplate | null>(null);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!request) { setTpl(null); setClientId(null); setCreating(false); return; }
    setTpl(getReportTemplate(request.templateId));
    setClientId(request.profileId ?? null);
    api.profiles.list().then(setClients).catch(() => {});
  }, [request]);

  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  if (!request) return null;

  const create = async () => {
    if (!tpl) return;
    setCreating(true);
    try {
      const project = await api.projects.create(newProjectFromState(tpl.seed(client)));
      onCreated(project);
    } catch { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-brand-ink/40 grid place-items-center p-4" onClick={onCancel}>
      <div className="card w-full max-w-xl max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            {tpl && <button className="btn-ghost !px-1.5 !py-1" onClick={() => setTpl(null)} title="Back to templates"><ArrowLeft size={15} /></button>}
            {tpl ? 'Who is this report for?' : 'New report'}
          </h3>
          <button className="btn-ghost !px-1.5 !py-1" onClick={onCancel}><X size={16} /></button>
        </div>

        {!tpl ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {REPORT_TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => setTpl(t)} className="card p-4 text-left hover:shadow-md hover:border-brand-green/40 transition">
                <span className={'grid place-items-center h-9 w-9 rounded-lg bg-brand-tint mb-2 ' + t.accent}><FileSpreadsheet size={18} /></span>
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-brand-muted mt-1 leading-relaxed">{t.description}</div>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1">
              <button onClick={() => setClientId(null)} className={'w-full text-left rounded-lg border px-3 py-2.5 text-sm transition ' + (!clientId ? 'border-brand-green bg-brand-tint' : 'border-brand-line hover:bg-brand-tint/50')}>
                <span className="font-medium">No client</span> <span className="text-brand-muted">— start blank, fill details by hand</span>
              </button>
              {clients.map((c) => (
                <button key={c.id} onClick={() => setClientId(c.id)} className={'w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-2.5 transition ' + (clientId === c.id ? 'border-brand-green bg-brand-tint' : 'border-brand-line hover:bg-brand-tint/50')}>
                  <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-tint text-brand-greenDark shrink-0"><Building2 size={15} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{c.name}</span>
                    <span className="block text-xs text-brand-muted truncate">{c.inputs.currentSupplier || (c.inputs as Record<string, string>).industry || 'Client record'}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-ghost" onClick={onCancel}>Cancel</button>
              <button className="btn-primary" onClick={create} disabled={creating}>
                {creating ? <Loader2 size={15} className="animate-spin" /> : null} Create report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
