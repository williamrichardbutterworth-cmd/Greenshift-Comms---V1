import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReceiptText, UploadCloud, Loader2, Building2, Check, X, FileText, Sparkles,
  CheckCircle2, AlertCircle, Gauge, Plus, ArrowLeft, ScanLine,
} from 'lucide-react';
import { api, type ClientProfile, type ClientFile, type ClientMeter, type BillField, type ReportInputs } from '../lib/api';
import { getMeters, meterLabel } from '../lib/clientProfile';

// Where each extracted bill field lands on the client record. `target` of 'meter.<x>'
// goes onto the selected meter; a plain key goes onto client inputs; no target = shown
// for context only (not stored).
const REGISTRY: Record<string, { label: string; group: string; target?: string }> = {
  // Supplier & account
  supplier: { label: 'Supplier', group: 'Supplier & account', target: 'currentSupplier' },
  accountNumber: { label: 'Account number', group: 'Supplier & account' },
  companyName: { label: 'Company name', group: 'Supplier & account', target: 'companyName' },
  businessAddress: { label: 'Supply address', group: 'Supplier & account', target: 'businessAddress' },
  postcode: { label: 'Postcode', group: 'Supplier & account', target: 'postcode' },
  billDate: { label: 'Bill date', group: 'Supplier & account' },
  // Meter (technical)
  meterType: { label: 'Fuel', group: 'Meter', target: 'meter.type' },
  mpan: { label: 'MPAN', group: 'Meter', target: 'meter.mpan' },
  mprn: { label: 'MPRN', group: 'Meter', target: 'meter.mprn' },
  meterSerial: { label: 'Meter serial', group: 'Meter', target: 'meter.serial' },
  profileClass: { label: 'Profile class', group: 'Meter', target: 'meter.profileClass' },
  meterClass: { label: 'Meter type', group: 'Meter', target: 'meter.meterType' },
  capacity: { label: 'Capacity (kVA)', group: 'Meter', target: 'meter.capacity' },
  // Rates & charges
  currentUnitRate: { label: 'Unit rate — single (p/kWh)', group: 'Rates & charges', target: 'currentUnitRate' },
  dayRate: { label: 'Day rate (p/kWh)', group: 'Rates & charges', target: 'meter.dayRate' },
  nightRate: { label: 'Night rate (p/kWh)', group: 'Rates & charges', target: 'meter.nightRate' },
  currentStanding: { label: 'Standing charge (p/day)', group: 'Rates & charges', target: 'currentStanding' },
  totalAmount: { label: 'Bill total (£)', group: 'Rates & charges' },
  cclRate: { label: 'CCL (p/kWh)', group: 'Rates & charges' },
  vatRate: { label: 'VAT rate', group: 'Rates & charges' },
  // Consumption
  consumption: { label: 'Annual consumption (kWh)', group: 'Consumption', target: 'consumption' },
  dayConsumption: { label: 'Day consumption (kWh)', group: 'Consumption', target: 'meter.dayConsumption' },
  nightConsumption: { label: 'Night consumption (kWh)', group: 'Consumption', target: 'meter.nightConsumption' },
  billPeriod: { label: 'Billing period', group: 'Consumption' },
  // Contract
  contractEnd: { label: 'Contract end date', group: 'Contract', target: 'contractEnd' },
  currentProduct: { label: 'Product / tariff', group: 'Contract', target: 'currentProduct' },
  contractType: { label: 'Contract type', group: 'Contract' },
};
const GROUP_ORDER = ['Supplier & account', 'Meter', 'Rates & charges', 'Consumption', 'Contract'];

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(file);
});
const isImage = (mime: string) => mime.startsWith('image/');

const CONF_TONE: Record<string, string> = {
  high: 'bg-brand-green/15 text-brand-greenDark',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-up/10 text-up',
};

// Identity fields default to NOT-applied: a bill is often addressed to a different
// trading entity / billing address, so the agent must opt in before overwriting them.
const IDENTITY = new Set(['companyName', 'businessAddress', 'postcode']);
const MAX_BILL_BYTES = 6 * 1024 * 1024;

const ANALYSING_STEPS = [
  'Reading the bill…',
  'Extracting supplier & account…',
  'Locating the meter point & consumption…',
  'Pulling unit rate & standing charge…',
  'Finding the contract end & tariff…',
  'Cross-checking the figures…',
];

export function BillAnalysis({ initialClientId }: { initialClientId?: string } = {}) {
  const [phase, setPhase] = useState<'setup' | 'analyzing' | 'review' | 'done'>('setup');
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [clientId, setClientId] = useState<string>('');
  const [meterChoice, setMeterChoice] = useState<string>(''); // '' unset · 'new' · meter index
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<ClientFile | null>(null);
  const [fields, setFields] = useState<BillField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'doc' | 'text'>('doc');
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState('');
  const markRef = useRef<HTMLElement | null>(null);

  useEffect(() => { api.profiles.list().then(setClients).catch(() => {}); }, []);
  // With a client tab active, assume the bill is for that client (still changeable).
  useEffect(() => { if (initialClientId) { setClientId(initialClientId); setMeterChoice(''); } }, [initialClientId]);
  const client = useMemo(() => clients.find((c) => c.id === clientId) ?? null, [clients, clientId]);
  const meters = client ? getMeters(client.inputs as ReportInputs) : [];

  // staged "analysing" ticker
  useEffect(() => {
    if (phase !== 'analyzing') return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, ANALYSING_STEPS.length - 1)), 1100);
    return () => clearInterval(t);
  }, [phase]);

  // scroll the active highlight into view when switching fields on the text tab
  useEffect(() => { if (leftTab === 'text') markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [activeKey, leftTab]);

  // On teardown (switching client tab / section remounts this), drop an un-approved
  // uploaded bill so it isn't orphaned on the server. A done (approved) bill is kept.
  const uploadedRef = useRef<ClientFile | null>(null); uploadedRef.current = uploaded;
  const phaseRef = useRef(phase); phaseRef.current = phase;
  useEffect(() => () => {
    if (uploadedRef.current && phaseRef.current !== 'done') api.files.remove(uploadedRef.current.id).catch(() => {});
  }, []);

  const analyse = async () => {
    if (!file || !client || !meterChoice) return;
    if (file.size > MAX_BILL_BYTES) { setErr('That bill is too large — please use a file under ~6 MB.'); return; }
    setErr(null); setPhase('analyzing');
    // Drop any file left over from a previous (failed/retried) attempt so we don't orphan it.
    if (uploaded) { api.files.remove(uploaded.id).catch(() => {}); setUploaded(null); }
    let savedId: string | null = null;
    try {
      const base64 = await fileToBase64(file);
      const saved = await api.files.upload({ name: file.name, mime: file.type, dataBase64: base64, clientProfileId: client.id });
      savedId = saved.id; setUploaded(saved);
      // A non-image file with no extractable text layer (a scanned/photographed PDF, an
      // image-only Word doc) gives the swarm nothing to read — and we can't rasterise it
      // to feed vision. Guide the user to re-upload it as a photo so vision can read it,
      // rather than failing with a generic message.
      const extracted = (saved.extractedText || '').trim();
      if (!extracted && !isImage(file.type)) {
        api.files.remove(saved.id).catch(() => {}); setUploaded(null);
        setErr('This file has no readable text layer — it looks like a scanned or image-only document. Please re-upload the bill as a photo or screenshot (JPG/PNG) so the analyser can read it visually.');
        setPhase('setup'); return;
      }
      const res = await api.bill.analyze({
        text: extracted || undefined,
        image: isImage(file.type) ? { base64, mime: file.type } : undefined,
      });
      const failed = (res.error && res.provider !== 'claude' && res.provider !== 'openai') || !res.fields.length;
      if (failed) {
        api.files.remove(saved.id).catch(() => {}); setUploaded(null);
        setErr(res.error || 'No fields could be read from this bill — try a clearer scan or a PDF with selectable text.');
        setPhase('setup'); return;
      }
      const v: Record<string, string> = {}; const a: Record<string, boolean> = {};
      for (const f of res.fields) { v[f.key] = f.value; if (REGISTRY[f.key]?.target && !IDENTITY.has(f.key)) a[f.key] = true; }
      setFields(res.fields); setValues(v); setApply(a);
      setPhase('review');
    } catch (e) {
      if (savedId) api.files.remove(savedId).catch(() => {});
      setUploaded(null); setErr(String((e as Error).message)); setPhase('setup');
    }
  };

  const approve = async () => {
    if (!client || !uploaded) return;
    setErr(null);
    const get = (key: string) => (apply[key] ? (values[key] ?? '').trim() : '');
    // Re-fetch the record so we merge onto the FRESHEST inputs/tracker — never clobber
    // edits (incl. meters) made on another surface since this screen opened.
    const fresh = await api.profiles.get(client.id).catch(() => client);
    const inputs = { ...(fresh.inputs as Record<string, unknown>) } as ReportInputs & Record<string, unknown>;

    // bill fuel (explicit, else inferred from the meter-point number)
    const typeVal = get('meterType');
    const billFuel: '' | 'gas' | 'electric' = typeVal === 'gas' || typeVal === 'electric' ? typeVal
      : get('mprn') && !get('mpan') ? 'gas' : get('mpan') ? 'electric' : '';

    const list: ClientMeter[] = Array.isArray(inputs.meters) ? [...(inputs.meters as ClientMeter[])] : [];
    const idx = meterChoice === 'new' ? -1 : Number(meterChoice);
    const existing = idx >= 0 ? list[idx] : undefined;
    // Guard: don't write an electricity bill onto a gas meter (or vice-versa).
    if (existing && billFuel && existing.type && billFuel !== existing.type) {
      setErr(`This looks like ${billFuel === 'gas' ? 'a gas' : 'an electricity'} bill, but the selected meter is ${existing.type}. Pick the matching meter or choose “New meter from this bill”.`);
      return;
    }

    // client-level fields (identity ones only apply if the agent ticked them)
    for (const f of fields) {
      const reg = REGISTRY[f.key]; const val = get(f.key);
      if (!reg?.target || reg.target.startsWith('meter.') || !val) continue;
      (inputs as Record<string, string>)[reg.target] = val;
    }
    // the meter — NEVER flips an existing meter's fuel (type is only set for a new one).
    const patch: Partial<ClientMeter> = {};
    if (get('mpan')) patch.mpan = get('mpan');
    if (get('mprn')) patch.mprn = get('mprn');
    if (get('meterSerial')) patch.serial = get('meterSerial');
    if (get('profileClass')) patch.profileClass = get('profileClass');
    if (get('meterClass')) patch.meterType = get('meterClass');
    if (get('capacity')) patch.capacity = get('capacity');
    if (get('supplier')) patch.supplier = get('supplier');
    if (get('contractEnd')) patch.contractEnd = get('contractEnd');
    // The supply address is a property of THIS meter, not the trading-entity identity the
    // opt-in guard protects — so name the meter's site from it even when the client-level
    // identity overwrite was left un-ticked. (Read raw, bypassing the apply gate.)
    const siteAddr = (values['businessAddress'] ?? '').trim();
    if (siteAddr) patch.siteAddress = siteAddr;
    // rate picture — a single unit rate lands on the day band; explicit day/night override it.
    const dayRate = get('dayRate') || get('currentUnitRate');
    if (dayRate) patch.dayRate = dayRate;
    if (get('nightRate')) patch.nightRate = get('nightRate');
    if (get('currentStanding')) patch.standing = get('currentStanding');
    // consumption split — a single-rate total lands on the day band.
    const dayC = get('dayConsumption') || (get('nightConsumption') ? '' : get('consumption'));
    if (dayC) patch.dayConsumption = dayC;
    if (get('nightConsumption')) patch.nightConsumption = get('nightConsumption');
    // keep a distinct annual total only when it wasn't already folded into the day band,
    // so a single-rate bill doesn't store the same figure on two meter fields.
    if (get('consumption') && get('consumption') !== dayC) patch.consumption = get('consumption');
    if (existing) list[idx] = { ...existing, ...patch };
    else list.push({ type: billFuel || 'electric', ...patch });
    inputs.meters = list;

    const tracker = { ...fresh.tracker, billReceived: fresh.tracker.billReceived || new Date().toISOString() };
    try {
      await api.profiles.update(client.id, { inputs, tracker });
      const detail = fields.filter((f) => apply[f.key]).map((f) => `• ${REGISTRY[f.key]?.label ?? f.key}: ${values[f.key]}`).join('\n');
      await api.profiles.addActivity(client.id, { type: 'file', title: `Bill analysed — ${get('supplier') || values.supplier || 'energy bill'}`, detail, meta: { fileId: uploaded.id } });
      setDoneMsg(`Saved to ${client.name} — record updated, bill filed, “Bill received” ticked.`);
      setPhase('done');
    } catch (e) { setErr(String((e as Error).message)); }
  };

  const reset = () => {
    // Abandoning the review without approving → drop the unsaved bill (a done/approved
    // bill is kept).
    if (phase === 'review' && uploaded) api.files.remove(uploaded.id).catch(() => {});
    setPhase('setup'); setFile(null); setUploaded(null); setFields([]); setValues({}); setApply({});
    setActiveKey(null); setMeterChoice(''); setErr(null); setDoneMsg('');
  };

  // ── header ──
  const header = (
    <div className="flex items-center gap-2.5 mb-1">
      <span className="grid place-items-center h-9 w-9 rounded-xl bg-brand-green/15 text-brand-greenDark"><ReceiptText size={18} /></span>
      <div>
        <h1 className="text-xl font-semibold leading-tight">Bill Analysis</h1>
        <p className="text-sm text-brand-muted">Upload a bill, point it at a client &amp; meter, and the analysis swarm extracts everything — you approve it straight into the record.</p>
      </div>
    </div>
  );

  if (phase === 'setup' || phase === 'analyzing') {
    return (
      <div className="max-w-2xl mx-auto">
        {header}
        <section className="card p-5 mt-4 space-y-4">
          {phase === 'analyzing' ? (
            <div className="py-10 text-center">
              <div className="relative mx-auto h-14 w-14 mb-4">
                <ScanLine size={56} className="text-brand-green animate-pulse" />
              </div>
              <p className="text-sm font-medium">{ANALYSING_STEPS[step]}</p>
              <p className="text-xs text-brand-muted mt-1">Running the bill-analysis swarm — supplier, meter, rates &amp; contract in parallel.</p>
            </div>
          ) : (
            <>
              {/* Upload */}
              <div>
                <label className="label mb-1.5 block">The bill</label>
                <label className={'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 cursor-pointer transition ' + (file ? 'border-brand-green bg-brand-tint/50' : 'border-brand-line hover:border-brand-green/50 hover:bg-brand-tint/30')}>
                  {file ? <FileText size={26} className="text-brand-greenDark" /> : <UploadCloud size={26} className="text-brand-muted" />}
                  <span className="text-sm font-medium">{file ? file.name : 'Drop a bill here or click to upload'}</span>
                  <span className="text-[11px] text-brand-muted">PDF, image, Word, Excel, CSV or text · up to ~6 MB</span>
                  <input type="file" accept=".pdf,.docx,.xlsx,.xlsm,.csv,.txt,.tsv,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
                </label>
              </div>
              {/* Client */}
              <div>
                <label className="label mb-1.5 block">Assign to client</label>
                <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setMeterChoice(''); }}>
                  <option value="">Select a client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {/* Meter */}
              {client && (
                <div>
                  <label className="label mb-1.5 block">Which meter is this bill for?</label>
                  <select className="input" value={meterChoice} onChange={(e) => setMeterChoice(e.target.value)}>
                    <option value="">Select a meter…</option>
                    {meters.map((m, i) => <option key={i} value={String(i)}>{meterLabel(m)}{m.siteAddress ? ` · ${m.siteAddress}` : ''}</option>)}
                    <option value="new">+ New meter from this bill</option>
                  </select>
                  {!meters.length && <p className="text-[11px] text-brand-muted mt-1">This client has no meters yet — the bill will create one.</p>}
                </div>
              )}
              {err && <p className="text-sm text-up flex items-center gap-1.5"><AlertCircle size={14} /> {err}</p>}
              <button className="btn-primary w-full justify-center" onClick={analyse} disabled={!file || !client || !meterChoice}>
                <Sparkles size={16} /> Analyse bill
              </button>
            </>
          )}
        </section>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="max-w-2xl mx-auto">
        {header}
        <section className="card p-8 mt-4 text-center">
          <CheckCircle2 size={40} className="text-brand-green mx-auto mb-3" />
          <h2 className="text-lg font-semibold">Bill approved &amp; saved</h2>
          <p className="text-sm text-brand-muted mt-1.5 mb-4">{doneMsg}</p>
          <button className="btn-primary mx-auto" onClick={reset}><Plus size={16} /> Analyse another bill</button>
        </section>
      </div>
    );
  }

  // ── review (side-by-side) ──
  const grouped = GROUP_ORDER.map((g) => ({ group: g, items: fields.filter((f) => (REGISTRY[f.key]?.group ?? 'Contract') === g) })).filter((x) => x.items.length);
  const appliedCount = fields.filter((f) => apply[f.key]).length;
  const meterName = meterChoice === 'new' ? 'a new meter' : (typeof meters[Number(meterChoice)] !== 'undefined' ? meterLabel(meters[Number(meterChoice)]) : 'meter');
  const activeSource = activeKey ? (fields.find((f) => f.key === activeKey)?.source ?? '') : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button className="btn-ghost !py-1.5 !px-2" onClick={reset}><ArrowLeft size={15} /> New analysis</button>
        <div className="text-sm text-brand-muted">Reviewing <span className="text-brand-ink font-medium">{client?.name}</span> · {meterName}</div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Left — the bill */}
        <section className="card p-0 overflow-hidden lg:sticky lg:top-[calc(var(--topbar-h)+12px)]">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-brand-line">
            <h3 className="text-sm font-semibold flex-1 truncate">{uploaded?.name}</h3>
            <div className="inline-flex rounded-lg border border-brand-line p-0.5 text-xs">
              <button onClick={() => setLeftTab('doc')} className={'px-2.5 py-1 rounded-md transition ' + (leftTab === 'doc' ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted')}>Document</button>
              <button onClick={() => setLeftTab('text')} className={'px-2.5 py-1 rounded-md transition ' + (leftTab === 'text' ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted')}>Extracted text</button>
            </div>
          </div>
          <div className="h-[calc(100vh-var(--topbar-h)-120px)] min-h-[480px] bg-[#f4f3f0]">
            {leftTab === 'doc' ? (
              uploaded && isImage(uploaded.mime)
                ? <div className="h-full overflow-auto p-3"><img src={api.files.downloadUrl(uploaded.id)} alt="bill" className="w-full rounded shadow-sm" /></div>
                : uploaded ? <iframe src={api.files.downloadUrl(uploaded.id)} title="bill" className="w-full h-full border-0" /> : null
            ) : (
              <div className="h-full overflow-auto p-4 text-[12px] leading-relaxed font-mono whitespace-pre-wrap text-brand-ink">
                {uploaded?.extractedText
                  ? <HighlightedText text={uploaded.extractedText} query={activeSource} markRef={markRef} />
                  : <span className="text-brand-muted">No selectable text in this file (it’s an image). The source quote on each field shows where it came from — cross-check it against the Document view.</span>}
              </div>
            )}
          </div>
        </section>

        {/* Right — extracted fields */}
        <section className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">Extracted information</h3>
            <span className="text-[11px] text-brand-muted">{appliedCount} field{appliedCount === 1 ? '' : 's'} to save · click a value to see its source</span>
          </div>
          <p className="text-[11px] text-brand-muted mb-3">Double-check each value (edit if needed), untick anything you don’t want, then approve to write it into the client record.</p>

          <div className="space-y-3.5 max-h-[calc(100vh-var(--topbar-h)-240px)] overflow-y-auto pr-1">
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">{group}</div>
                <div className="space-y-2">
                  {items.map((f) => {
                    const reg = REGISTRY[f.key];
                    const storable = !!reg?.target;
                    const on = !!apply[f.key];
                    const active = activeKey === f.key;
                    return (
                      <div key={f.key} className={'rounded-lg border px-2.5 py-2 transition ' + (active ? 'border-brand-green bg-brand-tint/40' : 'border-brand-line')}>
                        <div className="flex items-center gap-2">
                          {storable ? (
                            <button onClick={() => setApply((a) => ({ ...a, [f.key]: !on }))} title={on ? 'Will be saved' : 'Won’t be saved'} className={'grid place-items-center h-4 w-4 rounded border shrink-0 transition ' + (on ? 'bg-brand-green border-brand-green text-white' : 'border-brand-line text-transparent hover:border-brand-muted')}>
                              <Check size={11} />
                            </button>
                          ) : <span className="h-4 w-4 shrink-0" />}
                          <label className="text-[11px] text-brand-muted flex-1 truncate">{reg?.label ?? f.key}{!storable && <span className="ml-1 text-brand-muted/60">· info</span>}</label>
                          <span className={'text-[9px] uppercase tracking-wide px-1 rounded shrink-0 ' + (CONF_TONE[f.confidence] ?? '')}>{f.confidence}</span>
                        </div>
                        <input
                          className="input !py-1 text-sm mt-1"
                          value={values[f.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          onFocus={() => { setActiveKey(f.key); if (uploaded?.extractedText) setLeftTab('text'); }}
                        />
                        {f.source && (
                          <button onClick={() => { setActiveKey(f.key); if (uploaded?.extractedText) setLeftTab('text'); }} className="mt-1 w-full text-left text-[10.5px] text-brand-muted/90 italic leading-snug hover:text-brand-greenDark line-clamp-2" title="Show where this came from">
                            <span className="text-brand-muted/60 not-italic">from: </span>“{f.source}”
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {err && <p className="text-sm text-up mt-3 flex items-center gap-1.5"><AlertCircle size={14} /> {err}</p>}
          <div className="mt-3 pt-3 border-t border-brand-line flex items-center gap-2">
            <div className="text-[11px] text-brand-muted flex items-center gap-1.5 flex-1"><Gauge size={13} /> Saves to <span className="text-brand-ink">{client?.name}</span> · {meterName}; files the bill &amp; ticks “Bill received”.</div>
            <button className="btn-primary !py-1.5" onClick={approve} disabled={!appliedCount}><CheckCircle2 size={15} /> Approve &amp; save</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// Highlight `query` in `text`. Anchors BOTH ends in the document text: the full quote
// when present, else just its matched leading slice — so the highlight never overruns
// past genuinely-matching characters (the source/extractedText can drift in whitespace).
function HighlightedText({ text, query, markRef }: { text: string; query: string; markRef: React.MutableRefObject<HTMLElement | null> }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lc = text.toLowerCase();
  let idx = lc.indexOf(q.toLowerCase());
  let len = q.length;
  if (idx < 0) { const needle = q.slice(0, 60).toLowerCase(); idx = lc.indexOf(needle); len = needle.length; }
  if (idx < 0) return <>{text}</>;
  const end = idx + len;
  return (
    <>
      {text.slice(0, idx)}
      <mark ref={(el) => { markRef.current = el; }} className="bg-brand-green/30 text-brand-ink rounded px-0.5">{text.slice(idx, end)}</mark>
      {text.slice(end)}
    </>
  );
}
