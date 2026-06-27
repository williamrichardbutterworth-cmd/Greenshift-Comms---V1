import { useState } from 'react';
import { Pencil, Plus, Trash2, Gauge, Zap, Flame } from 'lucide-react';
import type { ReportInputs, ClientMeter } from '../lib/api';
import { CLIENT_FIELD_GROUPS, getField, getMeters, meterLabel } from '../lib/clientProfile';

// The comprehensive client record: everything we hold in one place. Captured
// fields show by default; blanks stay hidden until you edit (where every field +
// the meters are available to fill). Persists via onSave.
export function ClientProfilePanel({ inputs, onSave }: {
  inputs: ReportInputs;
  onSave: (next: ReportInputs) => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const meters = getMeters((editing ? draft : inputs) as ReportInputs);

  const start = () => { setDraft({ ...(inputs as Record<string, unknown>) }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => { await onSave(draft as ReportInputs); setEditing(false); };
  const set = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const setMeters = (next: ClientMeter[]) => setDraft((d) => ({ ...d, meters: next }));

  if (!editing) {
    const filledGroups = CLIENT_FIELD_GROUPS.map((g) => ({ g, fields: g.fields.filter((f) => getField(inputs, f.key)) })).filter((x) => x.fields.length);
    const anything = filledGroups.length || meters.length;
    return (
      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="label">Client record</div>
          <button className="text-xs text-brand-greenDark hover:underline inline-flex items-center gap-1" onClick={start}><Pencil size={12} /> Edit &amp; add</button>
        </div>
        {!anything ? (
          <p className="text-sm text-brand-muted">No details captured yet — click <span className="text-brand-greenDark">Edit &amp; add</span> to fill them in.</p>
        ) : (
          <div className="space-y-3.5">
            {filledGroups.map(({ g, fields }) => (
              <div key={g.group}>
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">{g.group}</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-2">
                  {fields.map((f) => (
                    <div key={String(f.key)} className="min-w-0">
                      <div className="text-[11px] text-brand-muted">{f.label}</div>
                      <div className="text-sm text-brand-ink truncate" title={getField(inputs, f.key)}>{getField(inputs, f.key)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {meters.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5 flex items-center gap-1"><Gauge size={11} /> Meters &amp; sites ({meters.length})</div>
                <div className="space-y-1.5">
                  {meters.map((m, i) => <MeterRow key={i} m={m} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="label">Client record — edit</div>
        <div className="flex gap-2">
          <button className="btn-primary !py-1 text-xs" onClick={save}>Save</button>
          <button className="btn-ghost !py-1 text-xs" onClick={cancel}>Cancel</button>
        </div>
      </div>
      <div className="space-y-4">
        {CLIENT_FIELD_GROUPS.map((g) => (
          <div key={g.group}>
            <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5">{g.group}</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
              {g.fields.map((f) => (
                <div key={String(f.key)}>
                  <label className="text-[11px] text-brand-muted block mb-0.5">{f.label}</label>
                  <input className="input !py-1.5 text-sm" placeholder={f.placeholder} value={String(draft[f.key as string] ?? '')} onChange={(e) => set(f.key as string, e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <MetersEditor meters={meters} onChange={setMeters} />
      </div>
    </section>
  );
}

function MeterRow({ m }: { m: ClientMeter }) {
  const Icon = m.type === 'gas' ? Flame : Zap;
  const num = m.type === 'gas' ? m.mprn : m.mpan;
  return (
    <div className="flex items-center gap-2 text-sm rounded-lg border border-brand-line px-2.5 py-1.5">
      <Icon size={13} className="text-brand-greenDark shrink-0" />
      <span className="font-medium shrink-0">{m.type === 'gas' ? 'Gas' : 'Electric'}</span>
      {num && <span className="font-mono text-xs text-brand-muted shrink-0">{num}</span>}
      <span className="flex-1 truncate text-brand-muted">{[m.siteAddress, m.supplier, m.contractEnd && `ends ${m.contractEnd}`, m.consumption].filter(Boolean).join(' · ')}</span>
    </div>
  );
}

function MetersEditor({ meters, onChange }: { meters: ClientMeter[]; onChange: (m: ClientMeter[]) => void }) {
  const upd = (i: number, patch: Partial<ClientMeter>) => onChange(meters.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const add = () => onChange([...meters, { type: 'electric' }]);
  const remove = (i: number) => onChange(meters.filter((_, j) => j !== i));
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-brand-muted mb-1.5 flex items-center gap-1"><Gauge size={11} /> Meters &amp; sites</div>
      <div className="space-y-2">
        {meters.map((m, i) => (
          <div key={i} className="rounded-lg border border-brand-line p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-brand-line p-0.5 text-xs">
                {(['electric', 'gas'] as const).map((t) => (
                  <button key={t} onClick={() => upd(i, { type: t })} className={'px-2 py-0.5 rounded capitalize ' + (m.type === t ? 'bg-brand-tint text-brand-greenDark font-medium' : 'text-brand-muted')}>{t}</button>
                ))}
              </div>
              <input className="input !py-1 text-xs flex-1" placeholder={m.type === 'gas' ? 'MPRN / MPR' : 'MPAN'} value={(m.type === 'gas' ? m.mprn : m.mpan) ?? ''} onChange={(e) => upd(i, m.type === 'gas' ? { mprn: e.target.value } : { mpan: e.target.value })} />
              <button className="text-brand-muted hover:text-up shrink-0" onClick={() => remove(i)}><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input !py-1 text-xs" placeholder="Site address" value={m.siteAddress ?? ''} onChange={(e) => upd(i, { siteAddress: e.target.value })} />
              <input className="input !py-1 text-xs" placeholder="Supplier" value={m.supplier ?? ''} onChange={(e) => upd(i, { supplier: e.target.value })} />
              <input className="input !py-1 text-xs" placeholder="Contract end" value={m.contractEnd ?? ''} onChange={(e) => upd(i, { contractEnd: e.target.value })} />
              <input className="input !py-1 text-xs" placeholder="Annual consumption" value={m.consumption ?? ''} onChange={(e) => upd(i, { consumption: e.target.value })} />
            </div>
          </div>
        ))}
        <button className="btn-ghost w-full !py-1.5 text-sm" onClick={add}><Plus size={14} /> Add a meter / site</button>
      </div>
    </div>
  );
}
