import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, Search, Sparkles, Loader2, Download, CheckCircle2, Circle, ShieldCheck,
  FileSignature, Zap, Flame, X,
} from 'lucide-react';
import { api, type ClientProfile, type ReportInputs, type ChCompanySummary } from '../lib/api';
import {
  LOA_FIELDS, LOA_GROUPS, SOURCE_LABEL, deriveLoaFromClient, loaCompleteness, loaValues, fillLoaPdf, loaFilename,
  type LoaData, type LoaSource, type CustomerVariables, type Fuel,
} from '../lib/loa';

const SERVICE_SUGGESTIONS = ['Contract renewal', 'New connection', 'Bill validation', 'Out-of-contract', 'Tender / quotes', 'Carbon / net-zero'];
const FUELS: { key: Exclude<Fuel, ''>; label: string; icon: typeof Zap }[] = [
  { key: 'electric', label: 'Electric', icon: Zap }, { key: 'gas', label: 'Gas', icon: Flame }, { key: 'both', label: 'Both', icon: Zap },
];

// The Letter of Authority section: pick a client, then a builder that pulls LOA
// details from the client record / conversations / Companies House / the website,
// tracks which fields are known vs missing, and exports the filled LOA PDF.
export function LoaSection() {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const refresh = useCallback(() => api.profiles.list().then(setClients).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  const active = activeId ? clients.find((c) => c.id === activeId) ?? null : null;
  if (active) return <LoaBuilder key={active.id} client={active} onBack={() => { setActiveId(null); refresh(); }} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><FileSignature size={20} className="text-brand-greenDark" /> Letters of Authority</h1>
        <p className="text-sm text-brand-muted mt-1">Pick a client to build their LOA — details are pulled from the client record, conversations, Companies House and their website; you fill any gaps and export the finished letter.</p>
      </div>
      {!clients.length ? (
        <div className="card p-10 text-center text-brand-muted text-sm">No clients yet — create one in the Clients section first.</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => {
            const { known, total } = loaCompleteness(deriveLoaFromClient(c.inputs as ReportInputs));
            const done = known === total;
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} className="card p-4 text-left hover:shadow-md transition group">
                <div className="flex items-start gap-3">
                  <span className="grid place-items-center h-10 w-10 rounded-lg bg-brand-tint text-brand-greenDark shrink-0"><Building2 size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-brand-muted mt-0.5">{(c.inputs as ReportInputs).currentSupplier || 'Supplier —'}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-brand-line overflow-hidden">
                    <div className={'h-full rounded-full ' + (done ? 'bg-brand-green' : 'bg-brand-greenDark/60')} style={{ width: `${(known / total) * 100}%` }} />
                  </div>
                  <span className={'text-[11px] font-medium shrink-0 ' + (done ? 'text-brand-green' : 'text-brand-muted')}>{done ? 'Ready' : `${known}/${total}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoaBuilder({ client, onBack }: { client: ClientProfile; onBack: () => void }) {
  const inputs = client.inputs as ReportInputs;
  const [loa, setLoa] = useState<LoaData>(() => deriveLoaFromClient(inputs));
  const [vars, setVars] = useState<CustomerVariables>(() => ((inputs as Record<string, unknown>).customerVariables as CustomerVariables | undefined) ?? {});
  const [busy, setBusy] = useState<null | 'convos' | 'ch' | 'gen' | 'save'>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chOpen, setChOpen] = useState(false);
  const [chResults, setChResults] = useState<ChCompanySummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { known, total, missing } = useMemo(() => loaCompleteness(loa), [loa]);

  const setField = (key: string, value: string, source: LoaSource = 'manual') => {
    setSaved(false);
    setLoa((d) => ({ ...d, [key]: { value, source } }));
  };
  // Merge extracted fields without clobbering values the agent already has.
  const mergeFields = (fields: Record<string, string>, source: LoaSource) => {
    setSaved(false);
    setLoa((d) => {
      const next = { ...d };
      for (const [k, v] of Object.entries(fields)) {
        if (v && v.trim() && !next[k]?.value?.trim()) next[k] = { value: v.trim(), source };
      }
      return next;
    });
  };

  const persist = async (nextLoa: LoaData, nextVars: CustomerVariables) => {
    setBusy('save'); setErr(null);
    try {
      await api.profiles.update(client.id, { inputs: { ...inputs, loa: nextLoa, customerVariables: nextVars } as ReportInputs });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };
  const save = () => persist(loa, vars);

  const readFromConvos = async () => {
    const text = client.activities
      .filter((a) => ['transcript', 'note', 'email-received', 'email-sent'].includes(a.type))
      .map((a) => [a.title, a.detail].filter(Boolean).join('\n')).join('\n\n');
    if (!text.trim()) { setNote('No conversations logged for this client yet.'); return; }
    setBusy('convos'); setErr(null); setNote(null);
    try {
      const res = await api.loa.extract(text, loaValues(loa));
      if (res.error && res.provider !== 'claude' && res.provider !== 'openai') setErr(res.error);
      else {
        mergeFields(res.fields, 'transcript');
        if (res.fuel && !vars.fuel) setVars((v) => ({ ...v, fuel: res.fuel }));
        if (res.services.length && !(vars.services?.length)) setVars((v) => ({ ...v, services: res.services }));
        setNote(`Read ${Object.keys(res.fields).length} field(s) from conversations.`);
      }
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };

  const chSearch = async () => {
    const q = loa.customerName?.value || client.name;
    setBusy('ch'); setErr(null); setChResults(null); setChOpen(true);
    try {
      const res = await api.loa.chSearch(q);
      if (res.error) setErr(res.error);
      setChResults(res.items);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };
  const applyCh = async (companyNumber: string) => {
    setBusy('ch'); setErr(null);
    try {
      const res = await api.loa.chCompany(companyNumber);
      const c = res.company;
      if (c) {
        setSaved(false);
        setLoa((d) => ({
          ...d,
          customerName: { value: c.title, source: 'companiesHouse' },
          registeredNo: { value: c.companyNumber, source: 'companiesHouse' },
          businessAddress: { value: c.registeredAddress, source: 'companiesHouse' },
          ...(c.postcode ? { postcode: { value: c.postcode, source: 'companiesHouse' as LoaSource } } : {}),
        }));
        setNote(`Verified against Companies House — ${c.status}.`);
      }
      setChOpen(false);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };

  const generate = async () => {
    setBusy('gen'); setErr(null);
    try {
      const bytes = await fillLoaPdf(loaValues(loa));
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = loaFilename(loa.customerName?.value ?? client.name); a.click();
      URL.revokeObjectURL(url);
      // Best-effort: persist current state + log the generation on the timeline.
      persist(loa, vars);
      api.profiles.addActivity(client.id, { type: 'document', title: 'Generated Letter of Authority' }).catch(() => {});
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };

  const toggleService = (s: string) => setVars((v) => {
    const cur = v.services ?? [];
    return { ...v, services: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] };
  });

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <button className="btn-ghost !py-1.5 !px-2" onClick={onBack}><ArrowLeft size={15} /> All clients</button>

      {/* Header + progress */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center h-11 w-11 rounded-xl bg-brand-green/15 text-brand-greenDark shrink-0"><FileSignature size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{client.name}</h2>
              <div className="text-sm text-brand-muted">Letter of Authority · {known}/{total} details ready{missing.length ? '' : ' — ready to export'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn-ghost !py-1.5" onClick={readFromConvos} disabled={busy === 'convos'} title="Pull LOA details from this client's logged conversations">
              {busy === 'convos' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Read from conversations
            </button>
            <button className="btn-ghost !py-1.5" onClick={chSearch} disabled={busy === 'ch'} title="Verify against Companies House">
              {busy === 'ch' ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Companies House
            </button>
            <button className="btn-primary !py-1.5" onClick={generate} disabled={busy === 'gen'}>
              {busy === 'gen' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Generate LOA
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-brand-line overflow-hidden">
            <div className="h-full rounded-full bg-brand-green transition-all" style={{ width: `${(known / total) * 100}%` }} />
          </div>
          <span className="text-xs text-brand-muted shrink-0">{Math.round((known / total) * 100)}% complete</span>
          <button className="btn-ghost !py-1 !px-2 text-xs shrink-0" onClick={save} disabled={busy === 'save'}>{saved ? 'Saved' : busy === 'save' ? 'Saving…' : 'Save'}</button>
        </div>
        {note && <p className="text-xs text-brand-greenDark mt-2">{note}</p>}
        {err && <p className="text-sm text-up mt-2">{err}</p>}
      </section>

      {/* Customer variables */}
      <section className="card p-4">
        <h3 className="text-sm font-semibold mb-2.5">What they buy</h3>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="label mr-1">Fuel</span>
          {FUELS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => { setVars((v) => ({ ...v, fuel: v.fuel === key ? '' : key })); }} aria-pressed={vars.fuel === key}
              className={'text-xs px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 transition ' + (vars.fuel === key ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Services</span>
          {SERVICE_SUGGESTIONS.map((s) => {
            const on = (vars.services ?? []).includes(s);
            return (
              <button key={s} onClick={() => toggleService(s)} className={'text-xs px-2 py-1 rounded-md border transition ' + (on ? 'border-brand-green bg-brand-tint text-brand-ink' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{s}</button>
            );
          })}
        </div>
      </section>

      {/* LOA fields, grouped */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">LOA details</h3>
          <span className="text-[11px] text-brand-muted">{missing.length ? `${missing.length} to fill` : 'All details captured'}</span>
        </div>
        <div className="space-y-4">
          {LOA_GROUPS.map((group) => (
            <div key={group}>
              <div className="label mb-1.5">{group}</div>
              <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2.5">
                {LOA_FIELDS.filter((f) => f.group === group).map((f) => {
                  const fv = loa[f.key];
                  const filled = !!fv?.value?.trim();
                  return (
                    <div key={f.key}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {filled ? <CheckCircle2 size={13} className="text-brand-green shrink-0" /> : <Circle size={13} className="text-brand-line shrink-0" />}
                        <label className="text-[11px] text-brand-muted flex-1 truncate">{f.label}</label>
                        {filled && fv && <span className="text-[9px] text-brand-greenDark bg-brand-tint px-1 rounded shrink-0">{SOURCE_LABEL[fv.source]}</span>}
                      </div>
                      <input
                        className="input !py-1.5 text-sm"
                        placeholder={f.hint || `Add ${f.label.toLowerCase()}…`}
                        value={fv?.value ?? ''}
                        onChange={(e) => setField(f.key, e.target.value)}
                        onBlur={() => { if (!saved) save(); }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Companies House results */}
      {chOpen && (
        <div className="fixed inset-0 z-30 bg-brand-ink/40 grid place-items-center p-4" onClick={() => setChOpen(false)}>
          <div className="card w-full max-w-lg max-h-[80vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold flex items-center gap-2"><ShieldCheck size={17} className="text-brand-greenDark" /> Companies House</h3>
              <button className="btn-ghost !px-1.5 !py-1" onClick={() => setChOpen(false)}><X size={16} /></button>
            </div>
            {busy === 'ch' && !chResults ? <p className="text-sm text-brand-muted">Searching…</p>
              : chResults && chResults.length ? (
                <div className="space-y-1.5">
                  {chResults.map((c) => (
                    <button key={c.companyNumber} onClick={() => applyCh(c.companyNumber)} className="w-full text-left card p-3 hover:bg-brand-tint transition">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm flex-1 truncate">{c.title}</span>
                        <span className={'text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ' + (c.status === 'active' ? 'bg-brand-green/15 text-brand-greenDark' : 'bg-up/10 text-up')}>{c.status}</span>
                      </div>
                      <div className="text-xs text-brand-muted mt-0.5">No. {c.companyNumber} · {c.addressSnippet}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-brand-muted">{err ? '' : 'No matching companies found. Companies House lookup needs an API key (COMPANIES_HOUSE_API_KEY) for live results.'}</p>
              )}
            {err && <p className="text-sm text-up mt-2">{err}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
