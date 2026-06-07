import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';

// A4 @96dpi (matches the .report-sheet width + page-break guides in index.css).
const A4_W = 794;
const A4_H = 1122;
const THUMB_W = 128;
const SCALE = THUMB_W / A4_W;

// Zoomed-out "page thumbnails" of the live A4 document. Clones the sheet's HTML
// (so rendered charts/tables/images appear), scales it down, and clips each card
// to one page. Click a card to scroll there; re-syncs (debounced) as you edit.
export function PageOverview({ editor }: { editor: Editor | null }) {
  const [html, setHtml] = useState('');
  const [pages, setPages] = useState(1);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => {
      const sheet = document.querySelector('.report-sheet') as HTMLElement | null;
      if (!sheet) return;
      setHtml(sheet.innerHTML);
      const h = Math.max(sheet.scrollHeight, sheet.offsetHeight, A4_H);
      setPages(Math.max(1, Math.ceil(h / A4_H)));
    };
    const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(sync, 400); };
    const onScroll = () => {
      const deck = document.querySelector('.report-deck') as HTMLElement | null;
      if (deck) setActive(Math.round(deck.scrollTop / A4_H));
    };

    sync();
    editor.on('update', debounced);
    window.addEventListener('resize', debounced);
    const deck = document.querySelector('.report-deck') as HTMLElement | null;
    deck?.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      editor.off('update', debounced);
      window.removeEventListener('resize', debounced);
      deck?.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [editor]);

  const goto = (i: number) => {
    const deck = document.querySelector('.report-deck') as HTMLElement | null;
    deck?.scrollTo({ top: i * A4_H, behavior: 'smooth' });
  };

  return (
    <div className="space-y-2 overflow-auto max-h-[74vh] pr-1 py-1">
      {Array.from({ length: pages }).map((_, i) => (
        <button
          key={i}
          onClick={() => goto(i)}
          className={'block mx-auto rounded-sm transition shadow-soft ' + (active === i ? 'ring-2 ring-brand-green' : 'ring-1 ring-brand-line hover:ring-brand-green/50')}
          style={{ width: THUMB_W, height: A4_H * SCALE, overflow: 'hidden', background: '#fff' }}
          title={`Page ${i + 1}`}
        >
          <div
            aria-hidden
            style={{ width: A4_W, padding: '64px 72px', boxSizing: 'border-box', transform: `scale(${SCALE}) translateY(${-i * A4_H}px)`, transformOrigin: 'top left', pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </button>
      ))}
      <div className="text-center text-[10px] text-brand-muted pt-0.5">{pages} page{pages > 1 ? 's' : ''}</div>
    </div>
  );
}
