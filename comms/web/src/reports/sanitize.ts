import DOMPurify from 'dompurify';

// The A4 editor is a contenteditable surface: anything the user types OR pastes lands in
// the report's HTML, which is then persisted (editedHtml), re-injected into the editor
// iframe, AND exported as a standalone .html a client opens. So that round-trip can't carry
// executable markup, we sanitise the captured body at the capture chokepoint.
//
// DOMPurify's defaults already strip <script>, inline on* handlers and javascript:/data:
// URLs while keeping the templates' inline SVG charts, tables and inline styles intact, so
// the pixel-perfect look survives. We only widen it to keep link `target`.
export function sanitizeReportHtml(html: string): string {
  // Editor only ever runs in the browser; guard so a non-DOM context is a no-op pass-through.
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return html;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
