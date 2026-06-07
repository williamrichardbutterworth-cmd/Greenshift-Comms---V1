import { TextRun, ExternalHyperlink } from 'docx';
import type { DocNode } from './api';

// Shared, pure helpers for turning a TipTap/ProseMirror document's inline content
// into styled runs. The PDF exporter does its own stateful line-layout with these
// runs; the Word exporter maps them straight to docx run children.

export interface InlineRun { text: string; bold: boolean; italic: boolean; href?: string; }

// Flatten a block node's inline content into styled runs. Hard breaks become a
// run whose text is '\n' (handled as a forced line break by both exporters).
export function inlineRuns(node: DocNode): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      runs.push({ text: '\n', bold: false, italic: false });
      continue;
    }
    if (child.type !== 'text' || !child.text) continue;
    const marks = child.marks ?? [];
    runs.push({
      text: child.text,
      bold: marks.some((m) => m.type === 'bold'),
      italic: marks.some((m) => m.type === 'italic'),
      href: marks.find((m) => m.type === 'link')?.attrs?.href as string | undefined,
    });
  }
  return runs;
}

export const plainText = (node: DocNode): string => inlineRuns(node).map((r) => r.text).join('');

export const hasMarks = (node: DocNode): boolean =>
  (node.content ?? []).some((c) => c.type === 'text' && (c.marks?.length ?? 0) > 0);

export const pdfFontStyle = (r: { bold: boolean; italic: boolean }): 'normal' | 'bold' | 'italic' | 'bolditalic' =>
  r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal';

// docx: a block node's inline content → TextRun / ExternalHyperlink children.
export function inlineToDocx(node: DocNode, base?: { italics?: boolean; color?: string }): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  for (const r of inlineRuns(node)) {
    if (r.text === '\n') { out.push(new TextRun({ break: 1 })); continue; }
    if (r.href) {
      out.push(new ExternalHyperlink({
        link: r.href,
        children: [new TextRun({ text: r.text, bold: r.bold, italics: r.italic || base?.italics, color: '318300', underline: {} })],
      }));
    } else {
      out.push(new TextRun({ text: r.text, bold: r.bold, italics: r.italic || base?.italics, color: base?.color }));
    }
  }
  if (!out.length) out.push(new TextRun({ text: '' }));
  return out;
}
