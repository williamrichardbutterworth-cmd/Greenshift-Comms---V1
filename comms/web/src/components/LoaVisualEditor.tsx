import { useState, type CSSProperties } from 'react';
import { GripVertical } from 'lucide-react';
import { LOA_FIELD_POS, LOA_PAGE_W, LOA_PAGE_H, type LoaFieldPos } from '../lib/loa';

// On-screen scale of the A4 template (pt → px). Coordinates are stored in pt and
// shared with the pdf-lib fill, so what you edit/drag here is what lands in the PDF.
const SCALE = 1.15;
const FONT_PT = 10;
const LINE_PT = 13;
// The field's `vy` is the text baseline (pt); the input's box-top sits this far
// above it so the on-screen text lands on the same baseline as the PDF fill.
const BASE_DY = LINE_PT * 0.78;

// A live, editable + draggable overlay of the real LOA template: the two template
// pages shown as images with each customer field positioned exactly where it prints.
export function LoaVisualEditor({ values, layout, onChange, onMove }: {
  values: Record<string, string>;
  layout: Record<string, { x: number; y: number }>;
  onChange: (key: string, value: string) => void;
  onMove: (key: string, x: number, y: number) => void;
}) {
  return (
    <div className="space-y-5">
      {[1, 2].map((pageNo) => (
        <div
          key={pageNo}
          className="relative mx-auto bg-white shadow-[0_10px_30px_-12px_rgba(43,42,46,0.45)] ring-1 ring-brand-line rounded-sm"
          style={{ width: LOA_PAGE_W * SCALE, height: LOA_PAGE_H * SCALE }}
        >
          <img src={`/loa-page-${pageNo}.png`} alt={`LOA page ${pageNo}`} draggable={false} className="absolute inset-0 w-full h-full select-none pointer-events-none rounded-sm" />
          {Object.entries(LOA_FIELD_POS).filter(([, p]) => p.page === pageNo).map(([key, pos]) => {
            const ov = layout[key];
            return (
              <FieldBox
                key={key}
                pos={pos}
                ptX={ov?.x ?? pos.x}
                ptY={ov?.y ?? pos.vy}
                value={values[key] ?? ''}
                onChange={(v) => onChange(key, v)}
                onMove={(x, y) => onMove(key, x, y)}
              />
            );
          })}
          <div className="absolute -top-2.5 left-2 text-[10px] uppercase tracking-wide text-brand-muted bg-white px-1.5 rounded">Page {pageNo}</div>
        </div>
      ))}
    </div>
  );
}

function FieldBox({ pos, ptX, ptY, value, onChange, onMove }: {
  pos: LoaFieldPos;
  ptX: number;
  ptY: number;
  value: string;
  onChange: (v: string) => void;
  onMove: (x: number, y: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragging(true);
    const sx = e.clientX, sy = e.clientY, bx = ptX, by = ptY;
    const mm = (ev: MouseEvent) => onMove(Math.round(bx + (ev.clientX - sx) / SCALE), Math.round(by + (ev.clientY - sy) / SCALE));
    const mu = () => { setDragging(false); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
  };

  const box: CSSProperties = { position: 'absolute', left: ptX * SCALE, top: (ptY - BASE_DY) * SCALE, width: pos.maxWidth * SCALE };
  const fontStyle: CSSProperties = { fontSize: FONT_PT * SCALE, lineHeight: `${LINE_PT * SCALE}px` };
  const inputCls = 'w-full bg-transparent outline-none text-brand-ink placeholder:text-brand-muted/30 rounded-[3px] px-0.5 -mx-0.5 transition-colors hover:bg-brand-green/[0.07] focus:bg-brand-green/[0.09] focus:ring-1 focus:ring-brand-green/40';

  return (
    <div className={'group ' + (dragging ? 'z-20' : 'z-10')} style={box}>
      <span
        onMouseDown={startDrag}
        title="Drag to reposition"
        className={'absolute -left-[18px] top-0 grid place-items-center text-brand-greenDark cursor-grab active:cursor-grabbing transition-opacity ' + (dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
        style={{ height: LINE_PT * SCALE }}
      >
        <GripVertical size={Math.round(FONT_PT * SCALE * 1.15)} />
      </span>
      {pos.multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={pos.maxLines ?? 3} spellCheck={false}
          className={inputCls + ' resize-none block'} style={fontStyle} placeholder="…" />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
          className={inputCls + ' block'} style={{ ...fontStyle, height: LINE_PT * SCALE }} placeholder="…" />
      )}
    </div>
  );
}
