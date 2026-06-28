// Export the rendered report. The templates are print-optimised A4 HTML docs, so we
// export from the live preview iframe: html2canvas → jsPDF for a one-click PDF, the
// browser print dialog for a vector "Save as PDF", plus raw HTML and the Excel blob.

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

// Render the iframe's `.sheet` to a single/multi-page A4 PDF.
export async function exportIframePdf(iframe: HTMLIFrameElement, filename: string): Promise<void> {
  const doc = iframe.contentDocument;
  const el = (doc?.querySelector('.sheet') ?? doc?.body) as HTMLElement | null;
  if (!el || !iframe.contentWindow) throw new Error('Preview not ready');
  // Wait for the template webfonts so text isn't captured in a fallback face.
  try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* no-op */ }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL('image/jpeg', 0.95);

  if (imgH <= pageH) {
    pdf.addImage(img, 'JPEG', 0, 0, imgW, imgH);
  } else {
    let y = 0;
    while (y < imgH) {
      if (y > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, -y, imgW, imgH);
      y += pageH;
    }
  }
  pdf.save(filename);
}

// True vector "Save as PDF" via the print dialog on the isolated preview document.
export function printIframe(iframe: HTMLIFrameElement): void {
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
}
