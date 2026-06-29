import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, Download, CheckCircle2, Circle, ShieldCheck,
  FileSignature, X, RotateCcw,
} from 'lucide-react';
import { api, type ClientProfile, type ReportInputs, type ChCompanySummary } from '../lib/api';
import {
  LOA_FIELDS, LOA_GROUPS, SOURCE_LABEL, deriveLoaFromClient, loaCompleteness, loaValues, fillLoaPdf, loaFilename, todayLong,
  type LoaData, type LoaSource,
} from '../lib/loa';
import { LoaVisualEditor } from './LoaVisualEditor';

// The Letter of Authority section: pick a client, then a visual builder that fills
// the real LOA template (editable + draggable) from the client record /
// conversations / Companies House, tracks known vs missing, and exports the PDF.
export function LoaSection({ initialClientId, onExit }: { initialClientId?: string | null; onExit?: () => void } = {}) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const refresh = useCallback(() => api.profiles.list().then(setClients).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  // Deep-link: open straight into a client's builder when navigated here from their hub.
  useEffect(() => { if (initialClientId) setActiveId(initialClientId); }, [initialClientId]);

  const active = activeId ? clients.find((c) => c.id === activeId) ?? null : null;
  // When a client tab scopes this section (onExit set), "Back" leaves the scope (to
  // the client hub) rather than dropping into the cross-client picker; on the Free tab
  // the picker IS the right destination.
  if (active) return <LoaBuilder key={active.id} client={active} onBack={() => { if (onExit) onExit(); else { setActiveId(null); refresh(); } }} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><FileSignature size={20} className="text-brand-greenDark" /> Letters of Authority</h1>
        <p className="text-sm text-brand-muted mt-1">Pick a client to build their LOA — details are pulled from the client record, conversations, Companies House and their website; you polish it on the template and export the finished letter.</p>
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

type Layout = Record<string, { x: number; y: number }>;

function LoaBuilder({ client, onBack }: { client: ClientProfile; onBack: () => void }) {
  const inputs = client.inputs as ReportInputs;
  const [loa, setLoa] = useState<LoaData>(() => {
    const d = deriveLoaFromClient(inputs);
    if (!d.dated?.value) d.dated = { value: todayLong(), source: 'manual' }; // seed the signing date
    return d;
  });
  const [layout, setLayout] = useState<Layout>(() => ((inputs as Record<string, unknown>).loaLayout as Layout | undefined) ?? {});
  const [busy, setBusy] = useState<null | 'convos' | 'ch' | 'gen' | 'save'>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [chOpen, setChOpen] = useState(false);
  const [chResults, setChResults] = useState<ChCompanySummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The freshest full inputs to persist onto (so saving the LOA doesn't roll back
  // profile data gathered since this client was last listed). Seeded from the prop,
  // replaced by the on-entry refetch below.
  const freshInputs = useRef<ReportInputs>(inputs);

  // On entry, re-pull the client record so anything gathered since (uploads /
  // transcripts that updated the profile) refreshes the auto-derived fields — no
  // manual "re-read" needed. Manual / Companies House / conversation pulls are kept,
  // including any edit in flight when the refetch lands.
  useEffect(() => {
    let cancelled = false;
    api.profiles.get(client.id).then((fresh) => {
      if (cancelled) return;
      const fi = fresh.inputs as ReportInputs;
      freshInputs.current = fi;
      const d = deriveLoaFromClient(fi);
      if (!d.dated?.value) d.dated = { value: todayLong(), source: 'manual' };
      setLoa((cur) => {
        const next = { ...d };
        for (const [k, v] of Object.entries(cur)) if (v?.value?.trim() && v.source !== 'profile') next[k] = v;
        return next;
      });
      setLayout(((fi as Record<string, unknown>).loaLayout as Layout | undefined) ?? {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [client.id]);

  const { known, total, missing } = useMemo(() => loaCompleteness(loa), [loa]);

  const setField = (key: string, value: string, source: LoaSource = 'manual') => {
    setSaved(false);
    setLoa((d) => ({ ...d, [key]: { value, source } }));
  };
  const moveField = (key: string, x: number, y: number) => {
    setSaved(false);
    setLayout((l) => ({ ...l, [key]: { x, y } }));
  };
  const resetLayout = () => { setSaved(false); setLayout({}); };
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

  const persist = async (nextLoa: LoaData, nextLayout: Layout) => {
    setBusy('save'); setErr(null);
    try {
      // Preserve everything else on inputs (incl. customerVariables, meters, current
      // position, which the client management owns) — only LOA data + layout are
      // written here, onto the FRESHEST inputs so we don't roll back profile data.
      await api.profiles.update(client.id, { inputs: { ...freshInputs.current, loa: nextLoa, loaLayout: nextLayout } as ReportInputs });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };
  const save = () => persist(loa, layout);

  const readFromConvos = async () => {
    const text = client.activities
      .filter((a) => ['transcript', 'note', 'email-received', 'email-sent'].includes(a.type))
      .map((a) => [a.title, a.detail].filter(Boolean).join('\n')).join('\n\n');
    if (!text.trim()) { setNote('No conversations logged for this client yet.'); return; }
    setBusy('convos'); setErr(null); setNote(null);
    try {
      const res = await api.loa.extract(text, loaValues(loa));
      if (res.error && res.provider !== 'claude' && res.provider !== 'openai') setErr(res.error);
      else { mergeFields(res.fields, 'transcript'); setNote(`Read ${Object.keys(res.fields).length} field(s) from conversations.`); }
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
      const bytes = await fillLoaPdf(loaValues(loa), { positions: layout });
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = loaFilename(loa.customerName?.value ?? client.name); a.click();
      URL.revokeObjectURL(url);
      persist(loa, layout);
      api.profiles.addActivity(client.id, { type: 'document', title: 'Generated Letter of Authority' }).catch(() => {});
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(null); }
  };

  return (
    <div className="max-w-[1240px] mx-auto space-y-4">
      <button className="btn-ghost !py-1.5 !px-2" onClick={onBack}><ArrowLeft size={15} /> All clients</button>

      {/* Header + actions */}
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid place-items-center h-11 w-11 rounded-xl bg-brand-green/15 text-brand-greenDark shrink-0"><FileSignature size={20} /></span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{client.name}</h2>
              <div className="text-sm text-brand-muted">Letter of Authority · {known}/{total} details{missing.length ? '' : ' — ready to export'}</div>
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
              {busy === 'gen' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Generate PDF
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

      {/* Visual template + field list */}
      <div className="grid xl:grid-cols-[auto_minmax(300px,1fr)] gap-4 items-start">
        {/* The live template */}
        <section className="card p-4 overflow-x-auto">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold">Letter of Authority</h3>
            <span className="text-[11px] text-brand-muted hidden sm:inline">— edit any field on the page; drag the handle to reposition</span>
            <button className="btn-ghost !py-1 !px-2 text-xs ml-auto" onClick={resetLayout} title="Reset all field positions"><RotateCcw size={12} /> Reset positions</button>
          </div>
          <LoaVisualEditor loa={loa} layout={layout} onChange={(k, v) => setField(k, v)} onMove={moveField} />
        </section>

        {/* Field list — provenance + precise editing */}
        <section className="card p-4 xl:sticky xl:top-[calc(var(--topbar-h)+16px)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Details</h3>
            <span className={'text-[11px] font-medium ' + (missing.length ? 'text-amber-600' : 'text-brand-green')}>{missing.length ? `${missing.length} to fill` : 'all captured'}</span>
          </div>
          {missing.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <div className="text-[11px] font-medium text-amber-700 mb-1.5">Still needed to complete the LOA</div>
              <div className="flex flex-wrap gap-1">
                {missing.map((k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-200 text-amber-700">{LOA_FIELDS.find((f) => f.key === k)?.label ?? k}</span>)}
              </div>
            </div>
          )}
          <div className="space-y-3.5 max-h-[60vh] overflow-y-auto pr-1">
            {LOA_GROUPS.map((group) => (
              <div key={group}>
                <div className="label mb-1.5">{group}</div>
                <div className="space-y-2">
                  {LOA_FIELDS.filter((f) => f.group === group).map((f) => {
                    const fv = loa[f.key];
                    const filled = !!fv?.value?.trim();
                    return (
                      <div key={f.key}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {filled ? <CheckCircle2 size={12} className="text-brand-green shrink-0" /> : <Circle size={12} className="text-brand-line shrink-0" />}
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
          <div className="mt-3 pt-3 border-t border-brand-line">
            <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">Source of truth</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-brand-muted">
              {([['bg-brand-green', 'Client'], ['bg-sky-500', 'Conversation'], ['bg-violet-500', 'Website'], ['bg-emerald-600', 'Companies House'], ['bg-brand-muted', 'Manual']] as const).map(([c, l]) => (
                <span key={l} className="inline-flex items-center gap-1"><span className={'h-2 w-2 rounded-full ' + c} /> {l}</span>
              ))}
            </div>
          </div>
        </section>
      </div>

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
