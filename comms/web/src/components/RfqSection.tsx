import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Building2, Sparkles, Loader2, Download, ClipboardList, Globe, MessageSquareText, Check, Save,
  FileSignature, ReceiptText, CheckCircle2, Circle, PhoneCall,
} from 'lucide-react';
import { api, type ClientProfile, type ReportInputs, type ClientFile } from '../lib/api';
import {
  RFQ_SECTIONS, RFQ_FIELDS, RFQ_SOURCE_LABEL, rfqFieldView, rfqAllValues, rfqCompleteness,
  setRfqField, applyRfqExtract, hasLoaDrafted, buildRfqDocx, rfqFilename, rfqIsMultiline,
  type RfqSource,
} from '../lib/rfq';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The RFQ section: pick a client, then a call-assistant + editable Lead Generation Form.
// Fields are bound to the client record (one source of truth) — everything the app gathers
// flows in automatically; you close the gaps on the RFQ call and export the Word form.
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
        <p className="text-sm text-brand-muted mt-1">Pick a client. Everything the app has gathered (record, website, transcripts) pre-fills the form; you close the gaps on the RFQ call and export the Word doc for the closer.</p>
      </div>
      {!clients.length ? (
        <div className="card p-10 text-center text-brand-muted text-sm">No clients yet — create one in the Clients section first.</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => {
            const { known, total } = rfqCompleteness(c.inputs as ReportInputs);
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
  const [inputs, setInputs] = useState<ReportInputs>(() => client.inputs as ReportInputs);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [busy, setBusy] = useState<null | 'web' | 'notes' | 'gen' | 'save'>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string>(() => String((client.inputs as Record<string, unknown>).website ?? '').trim());
  const [transcript, setTranscript] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const dirty = useRef(false);
  const hydrated = useRef(false); // one-shot: the entry refetch may apply only ONCE, never after an edit
  const inputsRef = useRef(inputs); inputsRef.current = inputs;

  // On entry, re-pull the client (the single source of truth) + its files, so anything
  // gathered since — bills, transcripts, edits in other sections — shows here. The one-shot
  // hydrated flag means a late-arriving GET can never clobber an edit (even after a save
  // clears `dirty`).
  useEffect(() => {
    let cancelled = false;
    api.profiles.get(client.id).then((fresh) => {
      if (!cancelled && !hydrated.current && !dirty.current) setInputs(fresh.inputs as ReportInputs);
      hydrated.current = true;
    }).catch(() => { hydrated.current = true; });
    api.files.list({ clientProfileId: client.id }).then((f) => { if (!cancelled) setFiles(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, [client.id]);

  // Debounced autosave straight to the client record — edits propagate across the app.
  useEffect(() => {
    if (!dirty.current) return;
    setSaved(false);
    const t = setTimeout(async () => {
      try { await api.profiles.update(client.id, { inputs: inputsRef.current }); dirty.current = false; setSaved(true); setTimeout(() => setSaved(false), 1600); }
      catch (e) { setErr(String((e as Error).message)); }
    }, 700);
    return () => clearTimeout(t);
  }, [inputs, client.id]);

  // Keys the user has started answering this session — they stay in the game-plan list even
  // once filled (so the input doesn't unmount mid-answer), showing a tick.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const markTouched = useCallback((key: string) => setTouched((t) => (t.has(key) ? t : new Set(t).add(key))), []);

  const update = useCallback((next: ReportInputs) => { dirty.current = true; hydrated.current = true; setInputs(next); }, []);
  const setField = useCallback((key: string, value: string, source: RfqSource = 'manual') => { markTouched(key); update(setRfqField(inputsRef.current, key, value, source)); }, [update, markTouched]);

  // Displayed value: billsAvailable defaults to "Yes" when bills are on file (read-time only —
  // no write to the record on open). Everything else resolves from the bound record/inputs.rfq.
  const fieldVal = (key: string): string => {
    const v = rfqFieldView(inputs, key).value;
    return (!v && key === 'billsAvailable' && files.length > 0) ? 'Yes' : v;
  };
  const isFilled = (key: string) => !!fieldVal(key).trim();
  const exportValues = (): Record<string, string> => Object.fromEntries(RFQ_FIELDS.map((f) => {
    const v = rfqFieldView(inputsRef.current, f.key).value;
    return [f.key, (!v && f.key === 'billsAvailable' && files.length > 0) ? 'Yes' : v];
  }));

  const comp = useMemo(() => { const known = RFQ_FIELDS.filter((f) => isFilled(f.key)).length; return { known, total: RFQ_FIELDS.length }; }, [inputs, files.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const company = rfqFieldView(inputs, 'companyName').value || client.name;
  const loaReady = hasLoaDrafted(inputs);

  const saveNow = async () => {
    setBusy('save'); setErr(null);
    try { await api.profiles.update(client.id, { inputs: inputsRef.current }); dirty.current = false; setSaved(true); setTimeout(() => setSaved(false), 1600); }
    catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const pullWebsite = async () => {
    if (!url.trim()) { setErr('Add the company website first.'); return; }
    setBusy('web'); setErr(null); setNote(null);
    try {
      const res = await api.rfq.scrape(url, rfqAllValues(inputsRef.current));
      if (res.error) setErr(res.error);
      else { const { inputs: merged, filled } = applyRfqExtract(inputsRef.current, res.fields, 'website'); update(merged); setNote(filled ? `Pulled ${filled} field${filled === 1 ? '' : 's'} from the website.` : 'Nothing new found on the website.'); }
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const readNotes = async () => {
    if (!transcript.trim()) { setErr('Paste a call transcript or notes first.'); return; }
    setBusy('notes'); setErr(null); setNote(null);
    try {
      const res = await api.rfq.extract(transcript, rfqAllValues(inputsRef.current));
      if (res.error) setErr(res.error);
      else { const { inputs: merged, filled } = applyRfqExtract(inputsRef.current, res.fields, 'transcript'); update(merged); setNote(filled ? `Filled ${filled} answer${filled === 1 ? '' : 's'} from your notes.` : 'No new answers found in those notes.'); }
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const generate = async () => {
    setBusy('gen'); setErr(null);
    try {
      try { await api.profiles.update(client.id, { inputs: inputsRef.current }); dirty.current = false; } catch { /* still generate */ }
      const blob = await buildRfqDocx(exportValues(), { company, preparedBy: rfqFieldView(inputs, 'leadGenName').value, date: new Date().toLocaleDateString('en-GB') });
      download(blob, rfqFilename(company));
      if (client.id) api.profiles.addActivity(client.id, { type: 'document', title: `Generated RFQ — ${company}` }).catch(() => {});
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(null); }
  };

  const allDone = comp.known === comp.total;

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost !px-2 !py-1.5"><ArrowLeft size={16} /></button>
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><ClipboardList size={18} className="text-brand-greenDark" /> RFQ — {client.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-40 h-1.5 rounded-full bg-brand-line overflow-hidden">
                <div className={'h-full rounded-full ' + (allDone ? 'bg-brand-green' : 'bg-brand-greenDark/70')} style={{ width: `${(comp.known / comp.total) * 100}%` }} />
              </div>
              <span className={'text-[12px] font-medium ' + (allDone ? 'text-brand-green' : 'text-brand-muted')}>{comp.known}/{comp.total} captured</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[12px] text-brand-green inline-flex items-center gap-1"><Check size={13} /> Saved</span>}
          <button onClick={saveNow} className="btn-ghost !py-1.5" disabled={!!busy}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save</button>
          <button onClick={generate} className="btn-primary !py-1.5" disabled={!!busy}>{busy === 'gen' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Generate Word</button>
        </div>
      </div>

      {(err || note) && <div className={'rounded-lg px-3 py-2 text-[12px] ' + (err ? 'bg-up/10 text-up' : 'bg-brand-tint text-brand-greenDark')}>{err || note}</div>}

      {/* auto-fill controls (feed the client record, which feeds the form) */}
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
        {/* LEFT — RFQ-call game plan: what's missing + how to ask it */}
        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="text-sm font-semibold flex items-center gap-1.5"><PhoneCall size={15} className="text-brand-greenDark" /> RFQ call game plan</h3>
            {/* readiness — this call is staged after bills + a signed LOA */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              <ReadyChip ok={loaReady} okLabel="LOA drafted" noLabel="LOA not yet" icon={<FileSignature size={12} />} />
              <ReadyChip ok={files.length > 0} okLabel={`${files.length} bill${files.length === 1 ? '' : 's'}/doc on file`} noLabel="No bills yet" icon={<ReceiptText size={12} />} />
            </div>
            <p className="text-[11px] text-brand-muted mt-2">{allDone ? 'Every detail captured — generate the form for the closer.' : `${comp.total - comp.known} to capture. Ask the questions below, or one-click N/A what doesn’t apply.`}</p>
          </section>

          {allDone ? (
            <section className="card p-5 text-center">
              <CheckCircle2 size={26} className="text-brand-green mx-auto mb-1.5" />
              <div className="font-medium text-sm">Form complete</div>
              <p className="text-[12px] text-brand-muted mt-1 mb-3">Every credential the closer needs is captured.</p>
              <button onClick={generate} className="btn-primary mx-auto" disabled={!!busy}><Download size={15} /> Generate Word</button>
            </section>
          ) : (
            RFQ_SECTIONS.map((section) => {
              // Show fields still to capture, plus any started this session (so they stay editable).
              const show = section.fields.filter((f) => !isFilled(f.key) || touched.has(f.key));
              if (!show.length) return null;
              const known = section.fields.filter((f) => isFilled(f.key)).length;
              return (
                <section key={section.title} className="card p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <h3 className="label">{section.title}</h3>
                    <span className="text-[11px] text-brand-muted">{known}/{section.fields.length}</span>
                  </div>
                  <div className="space-y-3">
                    {show.map((f) => {
                      const view = rfqFieldView(inputs, f.key);
                      const value = fieldVal(f.key);
                      const filled = !!value.trim();
                      return (
                        <div key={f.key}>
                          <label className="text-[12px] text-brand-ink mb-1 leading-snug flex items-start gap-1.5">
                            {filled ? <Check size={13} className="text-brand-green mt-0.5 shrink-0" /> : <Circle size={11} className="text-brand-line mt-1 shrink-0" />}
                            <span>{f.question}{view.derived && <span className="text-brand-muted"> · from the client record</span>}</span>
                          </label>
                          {view.derived ? (
                            <div className="input !py-1.5 text-sm bg-brand-tint/30 text-brand-muted">{value || 'Add this in the client’s meters'}</div>
                          ) : f.multiline ? (
                            <textarea value={value} onChange={(e) => setField(f.key, e.target.value)} rows={2} placeholder="Their answer…" className="input !py-1.5 text-sm resize-y" />
                          ) : (
                            <input value={value} onChange={(e) => setField(f.key, e.target.value)} placeholder="Their answer…" className="input !py-1.5 text-sm" />
                          )}
                          {!filled && !view.derived && !view.bound && (
                            <div className="flex gap-1.5 mt-1">
                              <button onClick={() => setField(f.key, 'N/A', 'na')} className="text-[10px] px-1.5 py-0.5 rounded bg-brand-line/50 text-brand-muted hover:bg-brand-line">N/A</button>
                              <button onClick={() => setField(f.key, 'Not discussed', 'na')} className="text-[10px] px-1.5 py-0.5 rounded bg-brand-line/50 text-brand-muted hover:bg-brand-line">Not discussed</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>

        {/* RIGHT — the editable document */}
        <div className="xl:sticky xl:top-[calc(var(--topbar-h)+16px)]">
          <div className="card p-6 max-h-[calc(100vh-var(--topbar-h)-40px)] overflow-y-auto">
            <h2 className="text-lg font-bold text-brand-ink">Greenshift Lead Generation Form</h2>
            <p className="text-[11px] text-brand-muted italic mb-1">Internal use only — qualification record for the pricing specialist. Edit any cell.</p>
            <p className="text-[11px] text-brand-muted mb-4">{[company && `Client: ${company}`, rfqFieldView(inputs, 'leadGenName').value && `Lead gen: ${rfqFieldView(inputs, 'leadGenName').value}`].filter(Boolean).join('  ·  ')}</p>
            {RFQ_SECTIONS.map((section) => (
              <div key={section.title} className="mb-4">
                <div className="text-[12px] font-semibold text-brand-greenDark mb-1">{section.title}</div>
                <table className="w-full border-collapse text-[11px] table-fixed">
                  <tbody>
                    {section.fields.map((f) => {
                      const view = rfqFieldView(inputs, f.key);
                      const value = fieldVal(f.key);
                      return (
                        <tr key={f.key} className="align-top">
                          <td className="border border-brand-line p-1.5 w-[52%] text-brand-ink">
                            {f.question}
                            {view.bound && <span className="ml-1 text-[8px] uppercase tracking-wide text-brand-greenDark/70 bg-brand-tint px-1 rounded align-middle">client</span>}
                            {view.derived && <span className="ml-1 text-[8px] uppercase tracking-wide text-brand-greenDark/60 bg-brand-tint px-1 rounded align-middle">from record</span>}
                            {view.source && view.source !== 'profile' && !view.bound && !view.derived && <span className="ml-1 text-[8px] uppercase tracking-wide text-brand-muted bg-brand-line/40 px-1 rounded align-middle">{RFQ_SOURCE_LABEL[view.source]}</span>}
                          </td>
                          <td className="border border-brand-line p-0">
                            {view.derived ? (
                              <div className="px-1.5 py-1 text-[11px] text-brand-muted" title="Edit this in the client’s meters">{value || '—'}</div>
                            ) : rfqIsMultiline(f.key) ? (
                              <textarea value={value} onChange={(e) => setField(f.key, e.target.value)} rows={2} placeholder="—" className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-brand-green/[0.06] resize-y" />
                            ) : (
                              <input value={value} onChange={(e) => setField(f.key, e.target.value)} placeholder="—" className="w-full bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-brand-green/[0.06]" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <div className="text-center text-[11px] text-brand-muted mt-1.5">Bound fields sync to the client record · exports as an editable .docx</div>
        </div>
      </div>
    </div>
  );
}

function ReadyChip({ ok, okLabel, noLabel, icon }: { ok: boolean; okLabel: string; noLabel: string; icon: React.ReactNode }) {
  return (
    <span className={'inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full ' + (ok ? 'bg-brand-tint text-brand-greenDark' : 'bg-brand-line/40 text-brand-muted')}>
      {ok ? <CheckCircle2 size={12} /> : <Circle size={12} />}{icon}{ok ? okLabel : noLabel}
    </span>
  );
}
