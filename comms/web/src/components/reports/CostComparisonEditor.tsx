import { Plus, Trash2, Star, Zap, Flame } from 'lucide-react';
import type { CostData, MeterLine, ProposedSupplier, SupplierLine } from '../../reports/types';
import { money0 } from '../../reports/engine';
import {
  meterCost, supplierMeterCost, currentTotal, supplierTotal, supplierLive, recommendedSupplierIndex, blankMeter, emptySupplier,
} from '../../reports/templates/costComparison';

// The cost-comparison data editor: the client's METERS (one row each, day/night split) and
// one-or-more PROPOSED suppliers quoting against the same consumption. Every annual cost
// recomputes live; the cheapest live supplier is auto-recommended unless one is starred.
export function CostComparisonEditor({ cost, onChange }: { cost: CostData; onChange: (c: CostData) => void }) {
  const meters = cost.meters.length ? cost.meters : [blankMeter()];
  const proposed = cost.proposed.length ? cost.proposed : [emptySupplier()];
  const recIdx = recommendedSupplierIndex(proposed, meters);
  const curTotal = currentTotal(meters);

  const setMeters = (next: MeterLine[]) => onChange({ ...cost, meters: next, proposed });
  const setMeter = (i: number, patch: Partial<MeterLine>) => setMeters(meters.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const addMeter = () => setMeters([...meters, blankMeter(meters[meters.length - 1]?.fuel ?? 'electric')]);
  const removeMeter = (i: number) => {
    const removed = meters[i];
    const nextMeters = meters.length > 1 ? meters.filter((_, j) => j !== i) : [blankMeter()];
    const nextProposed = proposed.map((s) => { const lines = { ...s.lines }; delete lines[removed.id]; return { ...s, lines }; });
    onChange({ ...cost, meters: nextMeters, proposed: nextProposed });
  };

  const setProposed = (next: ProposedSupplier[]) => onChange({ ...cost, meters, proposed: next });
  const setSupplier = (i: number, patch: Partial<ProposedSupplier>) => setProposed(proposed.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setLine = (i: number, meterId: string, patch: Partial<SupplierLine>) => setProposed(proposed.map((s, j) => {
    if (j !== i) return s;
    const cur = s.lines[meterId] ?? { dayRate: '', nightRate: '', standing: '' };
    return { ...s, lines: { ...s.lines, [meterId]: { ...cur, ...patch } } };
  }));
  const addSupplier = () => setProposed([...proposed, { ...emptySupplier(), recommended: false }]);
  const removeSupplier = (i: number) => setProposed(proposed.length > 1 ? proposed.filter((_, j) => j !== i) : [emptySupplier()]);
  const pickSupplier = (i: number) => setProposed(proposed.map((s, j) => ({ ...s, recommended: j === i ? !s.recommended : false })));

  return (
    <div className="space-y-4">
      {/* ── meters ── */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="label">Meters &amp; current rates</h3>
          <span className="text-[9px] uppercase tracking-wide text-brand-greenDark/70 bg-brand-tint px-1 rounded">from client meters</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-brand-line">
          <table className="border-collapse text-sm min-w-[760px] w-full">
            <thead>
              <tr className="bg-brand-tint/60 text-[9px] uppercase tracking-wide text-brand-muted">
                <Th>Meter no.</Th><Th>Fuel</Th><Th>Site</Th><Th>Current supplier</Th>
                <Th right>Day kWh</Th><Th right>Day p/kWh</Th><Th right>Night kWh</Th><Th right>Night p/kWh</Th><Th right>Standing</Th>
                <Th right>Annual £</Th><th className="border border-brand-line w-7" />
              </tr>
            </thead>
            <tbody>
              {meters.map((m, i) => (
                <tr key={m.id}>
                  <Cell><input className={inp} value={m.meterNumber} onChange={(e) => setMeter(i, { meterNumber: e.target.value })} placeholder="MPAN/MPRN" /></Cell>
                  <td className="border border-brand-line p-0">
                    <button type="button" onClick={() => setMeter(i, { fuel: m.fuel === 'gas' ? 'electric' : 'gas' })} title="Toggle fuel"
                      className="w-full h-full grid place-items-center py-1.5 text-brand-muted hover:text-brand-ink">
                      {m.fuel === 'gas' ? <Flame size={13} className="text-amber-500" /> : <Zap size={13} className="text-brand-greenDark" />}
                    </button>
                  </td>
                  <Cell><input className={inp} value={m.site} onChange={(e) => setMeter(i, { site: e.target.value })} placeholder="Site" /></Cell>
                  <Cell><input className={inp} value={m.currentSupplier} onChange={(e) => setMeter(i, { currentSupplier: e.target.value })} placeholder="British Gas" /></Cell>
                  <Cell><input className={inpNum} value={m.dayConsumption} onChange={(e) => setMeter(i, { dayConsumption: e.target.value })} placeholder="248,976" /></Cell>
                  <Cell><input className={inpNum} value={m.dayRate} onChange={(e) => setMeter(i, { dayRate: e.target.value })} placeholder="21.34" /></Cell>
                  <Cell><input className={inpNum} value={m.nightConsumption} onChange={(e) => setMeter(i, { nightConsumption: e.target.value })} placeholder="—" /></Cell>
                  <Cell><input className={inpNum} value={m.nightRate} onChange={(e) => setMeter(i, { nightRate: e.target.value })} placeholder="—" /></Cell>
                  <Cell><input className={inpNum} value={m.standing} onChange={(e) => setMeter(i, { standing: e.target.value })} placeholder="49.00" /></Cell>
                  <td className="px-2 py-1.5 border border-brand-line text-right font-mono tabular-nums text-xs">£{money0(meterCost(m))}</td>
                  <td className="text-center border border-brand-line">
                    <button onClick={() => removeMeter(i)} className="text-brand-muted/50 hover:text-up p-1.5" title="Remove meter"><Trash2 size={12} /></button>
                  </td>
                </tr>
              ))}
              <tr className="bg-brand-tint/30 font-medium">
                <td className="px-2 py-1.5 border border-brand-line text-[11px] uppercase tracking-wide text-brand-muted" colSpan={9}>Current total annual cost</td>
                <td className="px-2 py-1.5 border border-brand-line text-right font-mono tabular-nums">£{money0(curTotal)}</td>
                <td className="border border-brand-line" />
              </tr>
            </tbody>
          </table>
        </div>
        <button onClick={addMeter} className="btn-ghost !py-1 !px-2 text-xs mt-2"><Plus size={13} /> Add meter</button>
      </section>

      {/* ── proposed suppliers ── */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="label">Proposed suppliers</h3>
          <span className="text-[11px] text-brand-muted">★ = recommended (auto: cheapest)</span>
        </div>
        <div className="space-y-3">
          {proposed.map((s, i) => {
            const total = supplierTotal(s, meters);
            const live = supplierLive(s);
            const saving = Number.isFinite(curTotal) && live ? curTotal - total : NaN;
            const isRec = i === recIdx;
            return (
              <div key={s.id} className={'rounded-lg border p-3 ' + (isRec ? 'border-brand-green bg-brand-green/[0.04]' : 'border-brand-line')}>
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => pickSupplier(i)} title={isRec ? 'Recommended' : 'Mark recommended'}
                    className={'grid place-items-center shrink-0 ' + (isRec ? 'text-brand-greenDark' : 'text-brand-line hover:text-brand-muted')}>
                    <Star size={16} fill={isRec ? 'currentColor' : 'none'} />
                  </button>
                  <input className="input !py-1 text-sm font-semibold flex-1" value={s.name} onChange={(e) => setSupplier(i, { name: e.target.value })} placeholder="Supplier name (e.g. Engie)" />
                  <input className="input !py-1 text-sm w-32" value={s.term} onChange={(e) => setSupplier(i, { term: e.target.value })} placeholder="36-month fixed" />
                  <button onClick={() => removeSupplier(i)} className="text-brand-muted/50 hover:text-up p-1" title="Remove supplier"><Trash2 size={13} /></button>
                </div>
                <div className="overflow-x-auto rounded border border-brand-line">
                  <table className="border-collapse text-sm min-w-[480px] w-full">
                    <thead>
                      <tr className="bg-brand-tint/50 text-[9px] uppercase tracking-wide text-brand-muted">
                        <Th>Meter</Th><Th right>Day p/kWh</Th><Th right>Night p/kWh</Th><Th right>Standing</Th><Th right>Annual £</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {meters.map((m) => {
                        const line = s.lines[m.id];
                        return (
                          <tr key={m.id}>
                            <td className="px-2 py-1 border border-brand-line text-xs font-mono text-brand-muted">{m.meterNumber || (m.fuel === 'gas' ? 'Gas' : 'Elec')}</td>
                            <Cell><input className={inpNum} value={line?.dayRate ?? ''} onChange={(e) => setLine(i, m.id, { dayRate: e.target.value })} placeholder="21.07" /></Cell>
                            <Cell><input className={inpNum} value={line?.nightRate ?? ''} onChange={(e) => setLine(i, m.id, { nightRate: e.target.value })} placeholder="—" /></Cell>
                            <Cell><input className={inpNum} value={line?.standing ?? ''} onChange={(e) => setLine(i, m.id, { standing: e.target.value })} placeholder="62.40" /></Cell>
                            <td className="px-2 py-1 border border-brand-line text-right font-mono tabular-nums text-xs">£{money0(supplierMeterCost(line, m))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs">
                  <span className="font-mono tabular-nums">Total <b>£{live ? money0(total) : '—'}</b></span>
                  <span className={'font-mono tabular-nums font-medium ' + (Number.isFinite(saving) && saving >= 0 ? 'text-brand-greenDark' : 'text-up')}>
                    {Number.isFinite(saving) ? (saving >= 0 ? `Saves £${money0(saving)}/yr vs current` : `+£${money0(-saving)}/yr vs current`) : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={addSupplier} className="btn-ghost !py-1 !px-2 text-xs mt-2"><Plus size={13} /> Add proposed supplier</button>
        <p className="text-[11px] text-brand-muted mt-2">Consumption stays the meter’s — each supplier just quotes new rates, so every annual cost is like-for-like. Leave the night band blank for single-rate meters.</p>
      </section>
    </div>
  );
}

const inp = 'w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-brand-green/[0.06] focus:ring-1 focus:ring-brand-green/40 rounded-[2px]';
const inpNum = inp + ' font-mono tabular-nums text-right';

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={'font-medium px-2 py-1.5 border border-brand-line ' + (right ? 'text-right' : 'text-left')}>{children}</th>;
}
function Cell({ children }: { children: React.ReactNode }) {
  return <td className="p-0 border border-brand-line">{children}</td>;
}
