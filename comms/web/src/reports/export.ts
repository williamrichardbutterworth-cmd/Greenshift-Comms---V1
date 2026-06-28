// Small download helpers shared by the report studio. PDF/print/HTML rendering now lives
// in the A4 ReportEditor (which owns the paginated document); this module just turns a blob
// or string into a download and slugs filenames.

export function slug(s: string): string {
  return (s || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadHtml(html: string, filename: string): void {
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), filename);
}
