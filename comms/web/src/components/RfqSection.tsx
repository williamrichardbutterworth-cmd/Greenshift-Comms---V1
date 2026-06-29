import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, Download, ClipboardList, Globe, MessageSquareText, Check, Save,
} from 'lucide-react';
import { api, type ClientProfile, type ReportInputs } from '../lib/api';
import {
  RFQ_SECTIONS, RFQ_FIELDS, RFQ_SOURCE_LABEL, deriveRfqFromClient, rfqCompleteness, rfqValues, buildRfqDocx, rfqFilename,
  type RfqData, type RfqSource,
} from '../lib/rfq';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The RFQ (Lead Generation Form) section: pick a client, then a dual-panel builder that
// fills the internal qualification form from the client record + the company website +
// a pasted call transcript, tracks known vs missing, and exports an editable Word doc.
export function RfqSection({ initialClientId, onConsumed }: { initialClientId?: string | null; onConsumed?: () => void } = {}) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const refresh = useCallback(() => api.profiles.list().then(setClients).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (initialClientId) { setActiveId(initialClientId); onConsumed?.(); } }, [initialClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = activeId ? clients.find((c) => c.id === activeId) ?? null : null;
  if (active) return <RfqBuilder key={active.id} client={active} onBack={() => { setActiveId(null); refresh(); }} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><ClipboardList size={20} className="text-brand-greenDark" /> RFQ — Lead Generation Forms</h1>
        <p className="text-sm text-brand-muted mt-1">Pick a client to build their RFQ — basic details are pulled from the client record and website, and the qualification answers from your call notes. You polish it and export the Word form for the pricing specialist.</p>
      </div>
      {!clients.length ? (
        <div className="card p-10 text-center text-brand-muted text-sm">No clients yet — create one in the Clients section first.</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => {
            const { known, total } = rfqCompleteness(deriveRfqFromClient(c.inputs as ReportInputs));
            const done = known === total;
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} className="card p-4 text-left hover:shadow-md transition">
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
                  <span className={'text-[11px] font-medium shrink-0 ' + (done ? 'text-brand-green' : 'text-brand-muted')}>{known}/{total}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RfqBuilder({ client, onBack }: { client: ClientProfile; onBack: () => void }) {
  const inputs = client.inputs as ReportInputs;
  const [rfq, setRfq] = useState<RfqData>(() => deriveRfqFromClient(inputs));
  const [busy, setBusy] = useState<null | 'web' | 'notes' | 'gen' | 'save'>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string>(() => String((inputs as Record<string, unknown>).website ?? '').trim());
  const [transcript, setTranscript] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const freshInputs = useRef<ReportInputs>(inputs);

  // On entry, re-pull the client so anything gathered since (uploads / transcripts that
  // updated the profile) refreshes the auto-derived fields — manual / website / transcript
  // pulls are kept. Mirrors the LOA builder's auto-refresh.
  useEffect(() => {
    let cancelled = false;
    api.profiles.get(client.id).then((fresh) => {
      if (cancelled) return;
      const fi = fresh.inputs as ReportInputs;
      freshInputs.current = fi;
      const d = deriveRfqFromClient(fi);
      setRfq((cur) => { const next = { ...d }; for (const [k, v] of Object.entries(cur)) if (v?.value?.trim() && v.source !== 'profile') next[k] = v; return next; });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [client.id]);

  const { known, total } = useMemo(() => rfqCompleteness(rfq), [rfq]);
  const company = rfq.companyName?.value || client.name;

  const setField = (key: string, value: string, source: RfqSource = 'manual') => { setSaved(false); setRfq((d) => ({ ...d, [key]: { value, source } })); };
  // Merge extracted answers without clobbering values we already hold.
  const mergeFields = (fields: Record<string, string>, source: RfqSource) => {
    setSaved(false);
    setRfq((d) => { const next = { ...d }; for (const [k, v] of Object.entries(fields)) if (v && v.trim() && !next[k]?.value?.trim()) next[k] = { value: v.trim(), source }; return next; });
  };

  const persist = async () => {
    setBusy('save'); setErr(null);
    try {
      await api.profiles.update(client.id, { inputs: { ...freshInputs.current, rfq } as ReportInputs });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const pullWebsite = async () => {
    if (!url.trim()) { setErr('Add the company website first.'); return; }
    setBusy('web'); setErr(null); setNote(null);
    try {
      const res = await api.rfq.scrape(url, rfqValues(rfq));
      if (res.error) setErr(res.error);
      else { mergeFields(res.fields, 'website'); const n = Object.keys(res.fields).length; setNote(n ? `Pulled ${n} field${n === 1 ? '' : 's'} from the website.` : 'Nothing new found on the website.'); }
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const readNotes = async () => {
    if (!transcript.trim()) { setErr('Paste a call transcript or notes first.'); return; }
    setBusy('notes'); setErr(null); setNote(null);
    try {
      const res = await api.rfq.extract(transcript, rfqValues(rfq));
      if (res.error) setErr(res.error);
      else { mergeFields(res.fields, 'transcript'); const n = Object.keys(res.fields).length; setNote(n ? `Filled ${n} answer${n === 1 ? '' : 's'} from your notes.` : 'No answers found in those notes.'); }
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const generate = async () => {
    setBusy('gen'); setErr(null);
    try {
      // Persist the form first (best-effort) so reopening shows what we generated.
      try { await api.profiles.update(client.id, { inputs: { ...freshInputs.current, rfq } as ReportInputs }); } catch { /* still generate the doc */ }
      const blob = await buildRfqDocx(rfqValues(rfq), { company, preparedBy: rfq.leadGenName?.value, date: new Date().toLocaleDateString('en-GB') });
      download(blob, rfqFilename(company));
      if (client.id) api.profiles.addActivity(client.id, { type: 'document', title: `Generated RFQ — ${company}` }).catch(() => {});
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost !px-2 !py-1.5"><ArrowLeft size={16} /></button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><ClipboardList size={18} className="text-brand-greenDark" /> RFQ — {client.name}</h1>
            <p className="text-[12px] text-brand-muted">Internal lead-gen form for the pricing specialist · {known}/{total} fields</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[12px] text-brand-green inline-flex items-center gap-1"><Check size={13} /> Saved</span>}
          <button onClick={persist} className="btn-ghost !py-1.5" disabled={!!busy}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</button>
          <button onClick={generate} className="btn-primary !py-1.5" disabled={!!busy}>{busy === 'gen' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Generate Word</button>
        </div>
      </div>

      {(err || note) && <div className={'rounded-lg px-3 py-2 text-[12px] ' + (err ? 'bg-up/10 text-up' : 'bg-brand-tint text-brand-greenDark')}>{err || note}</div>}

      {/* auto-fill controls */}
      <section className="card p-4 space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-brand-muted block mb-0.5 flex items-center gap-1.5"><Globe size={12} /> Company website</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acme.co.uk" className="input !py-1.5 text-sm" />
          </div>
          <button onClick={pullWebsite} className="btn-ghost !py-1.5" disabled={!!busy}>{busy === 'web' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Pull basics</button>
        </div>
        <div>
          <button onClick={() => setShowNotes((s) => !s)} className="text-[12px] text-brand-greenDark inline-flex items-center gap-1.5"><MessageSquareText size={13} /> {showNotes ? 'Hide' : 'Paste a call transcript / notes'}</button>
          {showNotes && (
            <div className="mt-2 space-y-2">
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5} placeholder="Paste the qualification call transcript or your notes — we’ll fill the form’s answers." className="input !py-1.5 text-sm resize-y" />
              <button onClick={readNotes} className="btn-ghost !py-1.5" disabled={!!busy}>{busy === 'notes' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Read &amp; fill answers</button>
            </div>
          )}
        </div>
      </section>

      <div className="grid xl:grid-cols-2 gap-5 items-start">
        {/* editable fields */}
        <div className="space-y-4">
          {RFQ_SECTIONS.map((section) => (
            <section key={section.title} className="card p-4">
              <h3 className="label mb-2.5">{section.title}</h3>
              <div className="space-y-2.5">
                {section.fields.map((f) => {
                  const v = rfq[f.key];
                  return (
                    <div key={f.key}>
                      <label className="text-[11px] text-brand-muted block mb-0.5 flex items-center gap-1.5">
                        {f.question}
                        {v?.source && v.source !== 'manual' && <span className="text-[9px] uppercase tracking-wide text-brand-greenDark/70 bg-brand-tint px-1 rounded">{RFQ_SOURCE_LABEL[v.source]}</span>}
                      </label>
                      {f.multiline ? (
                        <textarea value={v?.value ?? ''} onChange={(e) => setField(f.key, e.target.value)} rows={2} className="input !py-1.5 text-sm resize-y" />
                      ) : (
                        <input value={v?.value ?? ''} onChange={(e) => setField(f.key, e.target.value)} className="input !py-1.5 text-sm" />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* live document preview */}
        <div className="xl:sticky xl:top-[calc(var(--topbar-h)+16px)]">
          <div className="card p-6 max-h-[calc(100vh-var(--topbar-h)-40px)] overflow-y-auto">
            <h2 className="text-lg font-bold text-brand-ink">Greenshift Lead Generation Form</h2>
            <p className="text-[11px] text-brand-muted italic mb-1">Internal use only — qualification record for the pricing specialist.</p>
            <p className="text-[11px] text-brand-muted mb-4">{[company && `Client: ${company}`, rfq.leadGenName?.value && `Lead gen: ${rfq.leadGenName.value}`].filter(Boolean).join('  ·  ')}</p>
            {RFQ_SECTIONS.map((section) => (
              <div key={section.title} className="mb-4">
                <div className="text-[12px] font-semibold text-brand-greenDark mb-1">{section.title}</div>
                <table className="w-full border-collapse text-[11px]">
                  <tbody>
                    {section.fields.map((f) => (
                      <tr key={f.key} className="align-top">
                        <td className="border border-brand-line p-1.5 w-[55%] text-brand-ink">{f.question}</td>
                        <td className="border border-brand-line p-1.5 text-brand-muted whitespace-pre-wrap">{rfq[f.key]?.value || <span className="text-brand-line">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="text-center text-[11px] text-brand-muted mt-1.5">Exports as an editable .docx · {RFQ_FIELDS.length} fields</div>
        </div>
      </div>
    </div>
  );
}
