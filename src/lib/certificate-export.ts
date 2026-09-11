/**
 * Client-side certificate export.
 *
 * The downloaded PDF is rasterised from the exact DOM node shown in the preview
 * modal, so "what you see is what you download" — both render the single
 * `CertificateDocument` component. This keeps the on-screen design and the
 * exported file perfectly in sync (and matching Figma) with no second renderer.
 * The bulk export shares the same rasteriser, so a page of a multi-certificate
 * PDF is byte-for-byte the single export of that certificate.
 */
import QRCode from 'qrcode';
import type { jsPDF } from 'jspdf';
import type { toPng } from 'html-to-image';

type ToPng = typeof toPng;

/** Generate a PNG data URL QR code for the certificate verification value. */
export async function generateQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 0,
    width: 264, // rendered at 88px @ 3x for crisp capture
    errorCorrectionLevel: 'M',
    color: { dark: '#1A1A1A', light: '#F6F5F0' },
  });
}

/**
 * The "Presented on" date exactly as the certificate artwork shows it. Shared
 * so the preview, the single export and every page of the bulk export cannot
 * drift into three different date formats.
 */
export function formatCertificateIssueDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'certificate';
}

/**
 * jspdf + html-to-image are only needed when a certificate is actually
 * exported, so they are loaded on demand at click time rather than shipped in
 * the initial bundle of the training/certificate UI.
 */
async function loadExporter(): Promise<{ toPng: ToPng; JsPDF: typeof jsPDF }> {
  // Ensure web fonts (Playfair, Sacramento, Suisse) are ready before capture.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const [htmlToImage, jspdf] = await Promise.all([import('html-to-image'), import('jspdf')]);
  return { toPng: htmlToImage.toPng, JsPDF: jspdf.jsPDF };
}

/** Rasterise one fixed-size `CertificateDocument` node to a PNG data URL. */
async function rasterizeCertificate(node: HTMLElement, toPngFn: ToPng): Promise<string> {
  return toPngFn(node, {
    pixelRatio: 2,
    width: node.offsetWidth,
    height: node.offsetHeight,
    cacheBust: true,
    backgroundColor: '#F6F5F0',
    style: {
      // neutralise any transform applied by the responsive preview wrapper
      transform: 'none',
      margin: '0',
    },
  });
}

function drawCertificatePage(pdf: jsPDF, dataUrl: string): void {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
}

/**
 * Rasterise the given certificate node and download it as an A4-landscape PDF.
 * The node is expected to be the fixed-size `CertificateDocument` element.
 */
export async function exportCertificatePdf(node: HTMLElement, filename: string): Promise<void> {
  const { toPng: toPngFn, JsPDF } = await loadExporter();

  // Capture before constructing the document, so a failed rasterisation leaves
  // no half-built PDF behind.
  const dataUrl = await rasterizeCertificate(node, toPngFn);
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  drawCertificatePage(pdf, dataUrl);
  pdf.save(`${sanitizeFilename(filename)}.pdf`);
}

/**
 * Download one A4-landscape PDF holding every given certificate node, one
 * designed certificate per page, in the order supplied.
 *
 * Nodes are rasterised one at a time: each capture allocates a full-page bitmap
 * at 2x, so capturing a learner's whole history at once would spike memory for
 * no gain.
 */
export async function exportCertificatesPdf(nodes: HTMLElement[], filename: string): Promise<void> {
  if (nodes.length === 0) {
    throw new Error('No certificates to export');
  }

  const { toPng: toPngFn, JsPDF } = await loadExporter();

  // jsPDF opens with one blank page, so the first certificate fills it and only
  // subsequent ones add a page — otherwise page 1 of every export is empty.
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  for (const [index, node] of nodes.entries()) {
    const dataUrl = await rasterizeCertificate(node, toPngFn);
    if (index > 0) pdf.addPage('a4', 'landscape');
    drawCertificatePage(pdf, dataUrl);
  }

  pdf.save(`${sanitizeFilename(filename)}.pdf`);
}
