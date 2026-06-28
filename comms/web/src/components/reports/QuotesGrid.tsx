import { Plus, Trash2, Star } from 'lucide-react';
import type { QuoteRow } from '../../reports/types';
import { annualCost, parseNum, money0 } from '../../reports/engine';

// An inline, spreadsheet-style editor for supplier quotes — the cost-comparison
// centrepiece. Editable cells with live-computed Annual cost + Saving columns, a
// Recommended picker, add/remove rows, and multi-cell PASTE (drop a block of quotes
// straight from a supplier email or a spreadsheet and it fills across + down).
const EDIT_COLS = ['supplier', 'term', 'unitRate', 'standing'] as const;
type EditCol = (typeof EDIT_COLS)[number];

const newQuote = (): QuoteRow => ({ id: Math.random().toString(36).slice(2, 9), supplier: '', term: '', unitRate: '', standing: '' });
const isLive = (q: QuoteRow) => !!(q.supplier.trim() || q.unitRate.trim() || q.standing.trim());

export function QuotesGrid({ quotes, annualKwh, currentCost, onChange }: {
  quotes: QuoteRow[];
  annualKwh: number;
  currentCost: number;
  onChange: (next: QuoteRow[]) => void;
}) {
  const set = (i: number, patch: Partial<QuoteRow>) => onChange(quotes.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const add = () => onChange([...quotes, newQuote()]);
  const remove = (i: number) => onChange(quotes.length > 1 ? quotes.filter((_, j) => j !== i) : [newQuote()]);
  const pick = (i: number) => onChange(quotes.map((q, j) => ({ ...q, recommended: j === i ? !q.recommended : false })));

  // Auto-recommendation preview: cheapest live row when none is explicitly chosen.
  const anyChosen = quotes.some((q) => q.recommended && isLive(q));
  let autoIdx = -1, autoCost = Infinity;
  quotes.forEach((q, i) => {
    if (!isLive(q)) return;
    const c = annualCost(parseNum(q.unitRate), parseNum(q.standing), annualKwh);
    if (Number.isFinite(c) && c < autoCost) { autoCost = c; autoIdx = i; }
  });

  const onPaste = (rowIdx: number, colIdx: number) => (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return; // single value → let the input handle it
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1);
    const next = quotes.slice();
    lines.forEach((line, ri) => {
      const cells = line.split('\t');
      const target = rowIdx + ri;
      while (next.length <= target) next.push(newQuote());
      cells.forEach((val, ci) => {
        const field = EDIT_COLS[colIdx + ci] as EditCol | undefined;
        if (field) next[target] = { ...next[target], [field]: val.trim() };
      });
    });
    onChange(next);
  };

  const cell = (i: number, col: number, field: EditCol, placeholder: string, mono = false) => (
    <td className="p-0 border border-brand-line">
      <input
        value={quotes[i][field] ?? ''}
        onChange={(e) => set(i, { [field]: e.target.value } as Partial<QuoteRow>)}
        onPaste={onPaste(i, col)}
        placeholder={placeholder}
        spellCheck={false}
        className={'w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-brand-green/[0.06] focus:ring-1 focus:ring-brand-green/40 rounded-[2px] ' + (mono ? 'font-mono tabular-nums text-right' : '')}
      />
    </td>
  );

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-brand-line">
        <table className="w-full border-collapse text-sm min-w-[640px]">
          <thead>
            <tr className="bg-brand-tint/60 text-[10px] uppercase tracking-wide text-brand-muted">
              <th className="font-medium text-left px-2 py-1.5 border border-brand-line w-8" title="Recommended"><Star size={12} className="inline" /></th>
              <th className="font-medium text-left px-2 py-1.5 border border-brand-line">Supplier</th>
              <th className="font-medium text-left px-2 py-1.5 border border-brand-line">Term</th>
              <th className="font-medium text-right px-2 py-1.5 border border-brand-line">Unit rate<br /><span className="normal-case tracking-normal text-brand-muted/70">p/kWh</span></th>
              <th className="font-medium text-right px-2 py-1.5 border border-brand-line">Standing<br /><span className="normal-case tracking-normal text-brand-muted/70">p/day</span></th>
              <th className="font-medium text-right px-2 py-1.5 border border-brand-line">Annual cost</th>
              <th className="font-medium text-right px-2 py-1.5 border border-brand-line">vs current</th>
              <th className="border border-brand-line w-8"></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q, i) => {
              const cost = annualCost(parseNum(q.unitRate), parseNum(q.standing), annualKwh);
              const live = isLive(q);
              const delta = live && Number.isFinite(currentCost) && Number.isFinite(cost) ? currentCost - cost : NaN;
              const chosen = !!q.recommended && live;
              const isAuto = !anyChosen && i === autoIdx;
              return (
                <tr key={q.id} className={chosen || isAuto ? 'bg-brand-green/[0.05]' : ''}>
                  <td className="text-center border border-brand-line">
                    <button onClick={() => pick(i)} title={chosen ? 'Recommended' : isAuto ? 'Auto: cheapest' : 'Mark recommended'}
                      className={'grid place-items-center w-full h-full py-1.5 ' + (chosen ? 'text-brand-greenDark' : isAuto ? 'text-brand-green/40' : 'text-brand-line hover:text-brand-muted')}>
                      <Star size={14} fill={chosen ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  {cell(i, 0, 'supplier', 'SmartestEnergy')}
                  {cell(i, 1, 'term', '36-month fixed')}
                  {cell(i, 2, 'unitRate', '23.40', true)}
                  {cell(i, 3, 'standing', '49.00', true)}
                  <td className="px-2 py-1.5 border border-brand-line text-right font-mono tabular-nums">{live && Number.isFinite(cost) ? `£${money0(cost)}` : <span className="text-brand-line">—</span>}</td>
                  <td className={'px-2 py-1.5 border border-brand-line text-right font-mono tabular-nums ' + (Number.isFinite(delta) ? (delta >= 0 ? 'text-brand-greenDark' : 'text-up') : 'text-brand-line')}>
                    {Number.isFinite(delta) ? (delta >= 0 ? `−£${money0(delta)}` : `+£${money0(-delta)}`) : '—'}
                  </td>
                  <td className="text-center border border-brand-line">
                    <button onClick={() => remove(i)} className="text-brand-muted/50 hover:text-up p-1.5" title="Remove row"><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between mt-2">
        <button onClick={add} className="btn-ghost !py-1 !px-2 text-xs"><Plus size={13} /> Add quote</button>
        <span className="text-[11px] text-brand-muted">Tip: paste a block of quotes from a supplier email or spreadsheet — it fills across &amp; down.</span>
      </div>
    </div>
  );
}
