import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { Bold, Italic, List, Scissors, Undo2 } from 'lucide-react';
import { sanitizeReportHtml } from '../../reports/sanitize';

// A fully dynamic A4 report editor: the report is rendered into real A4 page sheets,
// the text is editable inline, content auto-flows onto new pages, and the user can
// insert manual page breaks. Export produces a correctly-paginated multi-page PDF.
//
// Geometry: A4 at 96dpi = 794×1123px; ~16mm margins (60px); a 28px gutter between
// sheets on screen. Pagination is done by measuring each top-level block and inserting
// invisible spacers that push a block to the next sheet when it would overflow — the
// editable DOM nodes are never moved, so the caret is preserved while typing.
const A4_W = 794, A4_H = 1123, MARGIN = 60, GUTTER = 28;
const CONTENT_H = A4_H - 2 * MARGIN;

const EDITOR_CSS = `
  html,body{margin:0}
  body{background:#eceae6 !important; padding:24px 0 !important;}
  #scaler{position:relative; margin:0 auto;}
  #doc{position:absolute; top:0; left:0; width:${A4_W}px; transform-origin:top left;}
  #sheets{position:absolute; inset:0; z-index:0; pointer-events:none;}
  .pg-sheet{position:absolute; left:0; width:${A4_W}px; height:${A4_H}px; background:#fff; border-radius:2px; box-shadow:0 1px 2px rgba(0,0,0,.05),0 12px 34px rgba(0,0,0,.10);}
  #flow{position:relative; z-index:1; width:${A4_W}px; padding:${MARGIN}px; box-sizing:border-box; outline:none; min-height:${A4_H}px;}
  #flow:focus-visible{outline:none;}
  .pg-spacer{pointer-events:none; user-select:none;}
  .pg-break{height:0; border:0; border-top:1.5px dashed #40A800; margin:18px 0; position:relative; user-select:none;}
  .pg-break::after{content:'Page break'; position:absolute; right:0; top:-8px; font:600 8px 'IBM Plex Mono',ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; color:#318300; background:#eceae6; padding:0 5px;}
  table,.reco,.saving,.cards,.strip,.chartwrap,.summary,.current-table,thead,tr,.card,.masthead{break-inside:avoid;}
  @media print{
    body{background:#fff !important; padding:0 !important;}
    #doc{width:auto; height:auto !important;}
    #sheets{display:none;}
    #flow{position:static; width:auto; padding:0; min-height:0;}
    .pg-spacer{display:none !important;}
    .pg-break{break-before:page; border:0; height:0; margin:0;}
    .pg-break::after{display:none;}
    @page{size:A4; margin:16mm;}
    *{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
  }
`;

export interface ReportEditorHandle {
  exportPdf: (filename: string) => Promise<void>;
  print: () => void;
  getDocHtml: () => string;
}

function extractParts(fullHtml: string): { head: string; body: string } {
  const d = new DOMParser().parseFromString(fullHtml, 'text/html');
  const sheet = d.querySelector('.sheet');
  return { head: d.head.innerHTML, body: sheet ? sheet.innerHTML : d.body.innerHTML };
}
const buildDoc = (head: string, body: string) =>
  `<!doctype html><html lang="en-GB"><head>${head}<style>${EDITOR_CSS}</style></head><body><div id="scaler"><div id="doc"><div id="sheets"></div><div id="flow" contenteditable="true" spellcheck="false">${body}</div></div></div></body></html>`;

// Scale the A4 doc to fit the available width (never up past 1:1). The transform
// doesn't affect layout coords, so pagination measurement stays exact.
function fit(doc: Document, iframe: HTMLIFrameElement) {
  const scaler = doc.getElementById('scaler'); const docEl = doc.getElementById('doc');
  if (!scaler || !docEl) return;
  const avail = Math.max(280, iframe.clientWidth - 8);
  const s = Math.min(1, avail / A4_W);
  const docH = parseFloat(docEl.style.height) || A4_H;
  docEl.style.transform = s < 0.999 ? `scale(${s})` : 'none';
  scaler.style.width = `${A4_W * s}px`;
  scaler.style.height = `${docH * s}px`;
}

// Measure blocks and lay them out across A4 sheets; returns the page count.
function paginate(doc: Document): number {
  const flow = doc.getElementById('flow'); const sheets = doc.getElementById('sheets'); const docEl = doc.getElementById('doc');
  if (!flow || !sheets || !docEl) return 1;
  flow.querySelectorAll('.pg-spacer').forEach((s) => s.remove());
  const blocks = [...flow.children] as HTMLElement[];
  let page = 0, pending = false;
  const pageTopY = (p: number) => p * (A4_H + GUTTER) + MARGIN;             // content-top of page p
  const pageBottomY = (p: number) => p * (A4_H + GUTTER) + (A4_H - MARGIN); // content-bottom of page p
  const spacer = (before: Element, h: number) => {
    if (h <= 1) return;
    const s = doc.createElement('div'); s.className = 'pg-spacer';
    s.setAttribute('contenteditable', 'false'); s.setAttribute('aria-hidden', 'true');
    s.style.height = `${Math.round(h)}px`;
    flow.insertBefore(s, before);
  };
  for (const b of blocks) {
    if (b.classList?.contains('pg-spacer')) continue;
    let top = b.offsetTop;
    if (pending) { spacer(b, pageTopY(page) - top); pending = false; top = b.offsetTop; }
    if (b.classList?.contains('pg-break')) { page++; pending = true; continue; }
    // Push a block that would overflow the current page down to the next page top —
    // unless it already starts there (a too-tall block can't be pushed further).
    if (top + b.offsetHeight > pageBottomY(page) && top > pageTopY(page) + 2) {
      page++; spacer(b, Math.max(0, pageTopY(page) - top)); top = b.offsetTop;
    }
    // A block taller than the printable area spans multiple sheets: advance `page` past
    // every full page-height it occupies so the NEXT block references the right boundary
    // (otherwise its spacer goes negative and content overlaps / drops off the PDF).
    const spanned = Math.floor((b.offsetHeight - 1) / CONTENT_H);
    if (spanned > 0) page += spanned;
  }
  const count = page + 1;
  sheets.innerHTML = '';
  for (let i = 0; i < count; i++) { const sh = doc.createElement('div'); sh.className = 'pg-sheet'; sh.style.top = `${i * (A4_H + GUTTER)}px`; sheets.appendChild(sh); }
  docEl.style.height = `${count * A4_H + (count - 1) * GUTTER}px`;
  return count;
}

// Capture the editable body (minus the layout spacers) and sanitise it — this is the one
// chokepoint everything flows through (the stored override, the iframe re-injection, and
// the client-facing .html export), so a pasted <script>/<img onerror>/javascript: can never
// be persisted or shipped.
function captureBody(doc: Document): string {
  const flow = doc.getElementById('flow'); if (!flow) return '';
  const clone = flow.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.pg-spacer').forEach((s) => s.remove());
  return sanitizeReportHtml(clone.innerHTML);
}

export const ReportEditor = forwardRef<ReportEditorHandle, {
  html: string;                 // the full token-rendered report doc
  editedBody?: string;          // override blocks (when the user has edited)
  onChange: (body: string) => void;
  onPageCount?: (n: number) => void;
  /** Called once on unmount with the freshest body, so an edit made inside the debounce
   * window isn't lost when the studio is torn down (e.g. switching document tabs). */
  onFlush?: (body: string) => void;
}>(({ html, editedBody, onChange, onPageCount, onFlush }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false); // the user has typed into the page since the last load
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  const head = useMemo(() => extractParts(html).head, [html]);
  const tokenBody = useMemo(() => extractParts(html).body, [html]);
  const sourceBody = editedBody != null ? editedBody : tokenBody;

  const repaginate = useCallback(() => {
    const iframe = iframeRef.current; const doc = iframe?.contentDocument; if (!doc || !iframe) return;
    const n = paginate(doc); fit(doc, iframe); onPageCount?.(n);
  }, [onPageCount]);

  // Re-fit the A4 page to the panel width on resize.
  useEffect(() => {
    const iframe = iframeRef.current; if (!iframe || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const doc = iframe.contentDocument; if (doc) fit(doc, iframe); });
    ro.observe(iframe);
    return () => ro.disconnect();
  }, []);

  // Flush on unmount: a layout-effect cleanup runs while the iframe is still attached, so
  // if the page was actually edited we grab the freshest body (covering keystrokes still
  // inside the 280ms debounce, even the very first one before any emit) and hand it back for
  // persistence before the studio tab is torn down. No edit → no flush, so a data-driven
  // report is never pinned into edited mode.
  useLayoutEffect(() => () => {
    window.clearTimeout(timer.current);
    if (!dirtyRef.current) return;
    const doc = iframeRef.current?.contentDocument;
    const body = doc && doc.getElementById('flow') ? captureBody(doc) : lastEmitted.current;
    if (body != null) onFlushRef.current?.(body);
  }, []);

  const emit = useCallback(() => {
    const doc = iframeRef.current?.contentDocument; if (!doc) return;
    repaginate();
    const body = captureBody(doc);
    lastEmitted.current = body;
    onChange(body);
  }, [onChange, repaginate]);

  // (Re)load the iframe ONLY on an external source change — never on our own emits,
  // so typing doesn't reset the document / caret.
  useEffect(() => {
    if (sourceBody === lastEmitted.current) return;
    const iframe = iframeRef.current; if (!iframe) return;
    iframe.srcdoc = buildDoc(head, sourceBody);
  }, [head, sourceBody]);

  const onLoad = () => {
    const doc = iframeRef.current?.contentDocument; if (!doc) return;
    repaginate();
    (doc as Document & { fonts?: FontFaceSet }).fonts?.ready?.then(repaginate).catch(() => {});
    dirtyRef.current = false; // fresh document loaded — no unsaved page edits yet
    const flow = doc.getElementById('flow');
    flow?.addEventListener('input', () => { dirtyRef.current = true; window.clearTimeout(timer.current); timer.current = window.setTimeout(emit, 280); });
  };

  // ── toolbar actions (keep the iframe selection alive: preventDefault on mousedown) ──
  const exec = (cmd: string) => { const doc = iframeRef.current?.contentDocument; doc?.execCommand(cmd); emit(); };
  const insertBreak = () => {
    const doc = iframeRef.current?.contentDocument; const win = iframeRef.current?.contentWindow;
    const flow = doc?.getElementById('flow'); if (!doc || !win || !flow) return;
    let node = win.getSelection()?.anchorNode as Node | null;
    let block: Element | null = null;
    while (node && node !== flow) { if (node.parentNode === flow) { block = node as Element; break; } node = node.parentNode; }
    const br = doc.createElement('hr'); br.className = 'pg-break'; br.setAttribute('contenteditable', 'false');
    if (block?.nextSibling) flow.insertBefore(br, block.nextSibling); else flow.appendChild(br);
    emit();
  };

  // ── exports ──
  useImperativeHandle(ref, () => ({
    async exportPdf(filename: string) {
      const iframe = iframeRef.current; const doc = iframe?.contentDocument; const docEl = doc?.getElementById('doc');
      if (!iframe || !doc || !docEl) throw new Error('Editor not ready');
      const count = paginate(doc);
      try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* no-op */ }
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const scale = 2;
      // Render at TRUE A4 size (drop the fit-to-width visual scale) for a full-res PDF.
      const scaler = doc.getElementById('scaler'); const prevT = docEl.style.transform;
      const prevSW = scaler?.style.width ?? '', prevSH = scaler?.style.height ?? '';
      docEl.style.transform = 'none';
      if (scaler) { scaler.style.width = `${A4_W}px`; scaler.style.height = `${count * A4_H + (count - 1) * GUTTER}px`; }
      let canvas;
      try {
        canvas = await html2canvas(docEl, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: A4_W, windowHeight: docEl.scrollHeight });
      } finally {
        docEl.style.transform = prevT;
        if (scaler) { scaler.style.width = prevSW; scaler.style.height = prevSH; }
      }
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
      const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
      const sliceH = A4_H * scale;
      for (let i = 0; i < count; i++) {
        if (i > 0) pdf.addPage();
        const slice = document.createElement('canvas'); slice.width = canvas.width; slice.height = sliceH;
        const ctx = slice.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, slice.width, sliceH);
        ctx.drawImage(canvas, 0, i * (A4_H + GUTTER) * scale, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph);
      }
      pdf.save(filename);
    },
    print() { const w = iframeRef.current?.contentWindow; w?.focus(); w?.print(); },
    getDocHtml() {
      const doc = iframeRef.current?.contentDocument;
      const body = doc ? captureBody(doc) : sanitizeReportHtml(sourceBody);
      // Reproduce the editor's geometry (794px page, 60px padding → 674px content) — NOT the
      // template's wider `.sheet` — so the downloaded file wraps and breaks exactly like the
      // on-screen pages and the PDF (one consistent WYSIWYG layout across every export route).
      const exportCss = `html,body{margin:0}body{background:#eceae6}`
        + `.doc{width:${A4_W}px;margin:24px auto;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05),0 12px 34px rgba(0,0,0,.10)}`
        + `.doc-flow{width:${A4_W}px;padding:${MARGIN}px;box-sizing:border-box}`
        + `.pg-break{height:0;border:0;border-top:1.5px dashed #40A800;margin:18px 0}.pg-break::after{display:none}`
        + `@media print{body{background:#fff}.doc{width:auto;margin:0;box-shadow:none}.doc-flow{width:auto;padding:0}`
        + `.pg-break{break-before:page;border:0;height:0;margin:0}@page{size:A4;margin:16mm}`
        + `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
      return `<!doctype html><html lang="en-GB"><head>${head}<style>${exportCss}</style></head><body><div class="doc"><div class="doc-flow">${body}</div></div></body></html>`;
    },
  }), [head, sourceBody]);

  const tbBtn = 'grid place-items-center h-7 w-7 rounded-md text-brand-muted hover:text-brand-ink hover:bg-brand-tint transition';
  const guard = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="rounded-lg overflow-hidden ring-1 ring-brand-line shadow-soft bg-[#eceae6]">
      <div className="flex items-center gap-1 px-2 py-1.5 bg-white border-b border-brand-line">
        <button className={tbBtn} title="Bold" onMouseDown={guard} onClick={() => exec('bold')}><Bold size={14} /></button>
        <button className={tbBtn} title="Italic" onMouseDown={guard} onClick={() => exec('italic')}><Italic size={14} /></button>
        <button className={tbBtn} title="Bulleted list" onMouseDown={guard} onClick={() => exec('insertUnorderedList')}><List size={14} /></button>
        <span className="w-px h-4 bg-brand-line mx-1" />
        <button className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-brand-greenDark hover:bg-brand-tint transition" title="Insert a page break at the cursor" onMouseDown={guard} onClick={insertBreak}><Scissors size={13} /> Page break</button>
        <span className="w-px h-4 bg-brand-line mx-1" />
        <button className={tbBtn} title="Undo" onMouseDown={guard} onClick={() => exec('undo')}><Undo2 size={14} /></button>
        <span className="ml-auto text-[11px] text-brand-muted pr-1">Click the page to edit</span>
      </div>
      {/* sandbox WITHOUT allow-scripts: the parent drives the doc (measurement/execCommand)
          over the same origin, but any markup the user pastes can't execute in the editor. */}
      <iframe ref={iframeRef} onLoad={onLoad} sandbox="allow-same-origin" title="Report editor" className="w-full h-[calc(100vh-var(--topbar-h)-92px)] min-h-[560px] border-0 bg-[#eceae6]" />
    </div>
  );
});
