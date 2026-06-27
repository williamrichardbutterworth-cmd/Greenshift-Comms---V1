import { Zap, Flame } from 'lucide-react';
import type { CustomerVariables, Fuel } from '../lib/loa';

// Per-client "what they buy" — fuel + services. A client attribute (not an LOA
// detail) that tailors which sections/data their reports include.
const SERVICE_SUGGESTIONS = ['Contract renewal', 'New connection', 'Bill validation', 'Out-of-contract', 'Tender / quotes', 'Carbon / net-zero'];
const FUELS: { key: Exclude<Fuel, ''>; label: string; icon: typeof Zap }[] = [
  { key: 'electric', label: 'Electric', icon: Zap }, { key: 'gas', label: 'Gas', icon: Flame }, { key: 'both', label: 'Both', icon: Zap },
];

export function CustomerVariablesEditor({ value, onChange }: {
  value: CustomerVariables;
  onChange: (v: CustomerVariables) => void;
}) {
  const setFuel = (f: Exclude<Fuel, ''>) => onChange({ ...value, fuel: value.fuel === f ? '' : f });
  const toggleService = (s: string) => {
    const cur = value.services ?? [];
    onChange({ ...value, services: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
  };
  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold mb-0.5">What they buy</h3>
      <p className="text-[11px] text-brand-muted mb-2.5">Tailors the data &amp; sections included in their reports.</p>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="label mr-1">Fuel</span>
        {FUELS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setFuel(key)} aria-pressed={value.fuel === key}
            className={'text-xs px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 transition ' + (value.fuel === key ? 'border-brand-green bg-brand-tint text-brand-ink font-medium' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="label mr-1 w-full sm:w-auto">Services</span>
        {SERVICE_SUGGESTIONS.map((s) => {
          const on = (value.services ?? []).includes(s);
          return (
            <button key={s} onClick={() => toggleService(s)}
              className={'text-xs px-2 py-1 rounded-md border transition ' + (on ? 'border-brand-green bg-brand-tint text-brand-ink' : 'border-brand-line text-brand-muted hover:text-brand-ink')}>{s}</button>
          );
        })}
      </div>
    </section>
  );
}
