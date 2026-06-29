import { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, Building2, ArrowRight } from 'lucide-react';
import { api, type ClientProfile, type ReportInputs, type ActivityType } from '../lib/api';
import { EmailThread } from './EmailThread';
import { gatherAngles } from '../lib/crm';
import { useClientTabs } from '../workspace/ClientTabsContext';

// The Emails section. With a client tab active it shows that client's dialogue
// (lifted out of the client hub). On the Free tab it's a picker — choose a client
// and it opens as a tab, scoping every section to them.
export function EmailsSection({ clientId }: { clientId: string | null }) {
  if (clientId) return <ClientEmails key={clientId} clientId={clientId} />;
  return <EmailsPicker />;
}

function ClientEmails({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.profiles.get(clientId).then(setClient).catch((e) => setErr(String((e as Error).message)));
  }, [clientId]);

  const logActivity = useCallback(
    async (a: { type: ActivityType; title: string; detail?: string; meta?: Record<string, unknown> }) => {
      try { const updated = await api.profiles.addActivity(clientId, a); setClient(updated); return updated; }
      catch (e) { setErr(String((e as Error).message)); return null; }
    },
    [clientId],
  );

  if (err && !client) return <div className="max-w-wide mx-auto"><p className="text-sm text-up" role="alert">{err}</p></div>;
  if (!client) return <div className="max-w-wide mx-auto"><Loader2 className="animate-spin text-brand-green mt-10 mx-auto" size={22} /></div>;

  const inputs = client.inputs as ReportInputs;
  const angles = gatherAngles(client.activities);

  return (
    <div className="max-w-wide mx-auto space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center h-9 w-9 rounded-xl bg-brand-green/15 text-brand-greenDark"><Mail size={18} /></span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Emails — {client.name}</h1>
          <p className="text-sm text-brand-muted">The full conversation, with AI-drafted next emails &amp; replies grounded in the thread and this client&rsquo;s talk track.</p>
        </div>
      </div>
      <EmailThread client={client} inputs={inputs} angles={angles} logActivity={logActivity} />
      {err && <p className="text-sm text-up" role="alert">{err}</p>}
    </div>
  );
}

function EmailsPicker() {
  const { openClient } = useClientTabs();
  const [clients, setClients] = useState<ClientProfile[]>([]);

  useEffect(() => { api.profiles.list().then(setClients).catch(() => {}); }, []);

  return (
    <div className="max-w-content mx-auto">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="grid place-items-center h-9 w-9 rounded-xl bg-brand-green/15 text-brand-greenDark"><Mail size={18} /></span>
        <div>
          <h1 className="text-xl font-semibold leading-tight">Emails</h1>
          <p className="text-sm text-brand-muted">Pick a client to manage their dialogue — it opens as a tab, scoping the whole app to them.</p>
        </div>
      </div>
      {clients.length === 0 ? (
        <p className="text-sm text-brand-muted card p-5">No clients yet — create one from the Clients section.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {clients.map((c) => {
            const inputs = c.inputs as ReportInputs;
            const emailCount = c.activities.filter((a) => a.type === 'email-sent' || a.type === 'email-received').length;
            return (
              <button key={c.id} onClick={() => openClient(c.id, c.name)} className="card p-4 text-left hover:border-brand-green/50 hover:shadow-soft transition group">
                <div className="flex items-start gap-2.5">
                  <span className="grid place-items-center h-9 w-9 rounded-lg bg-brand-tint text-brand-greenDark shrink-0"><Building2 size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-brand-muted mt-0.5">{emailCount > 0 ? `${emailCount} message${emailCount === 1 ? '' : 's'}` : 'No emails yet'}{inputs.currentSupplier ? ` · ${inputs.currentSupplier}` : ''}</div>
                  </div>
                  <ArrowRight size={15} className="text-brand-muted group-hover:text-brand-green shrink-0 mt-1 transition" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
