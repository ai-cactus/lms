/**
 * Client-side certificate export.
 *
 * The downloaded PDF is rasterised from the exact DOM node shown in the preview
 * modal, so "what you see is what you download" — both render the single
 * `CertificateDocument` component. This keeps the on-screen design and the
 * exported file perfectly in sync (and matching Figma) with no second renderer.
 */
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

/** Generate a PNG data URL QR code for the certificate verification value. */
export async function generateQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 0,
    width: 264, // rendered at 88px @ 3x for crisp capture
    errorCorrectionLevel: 'M',
    color: { dark: '#1A1A1A', light: '#F6F5F0' },
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'certificate';
}

/**
 * Rasterise the given certificate node and download it as an A4-landscape PDF.
 * The node is expected to be the fixed-size `CertificateDocument` element.
 */
export async function exportCertificatePdf(node: HTMLElement, filename: string): Promise<void> {
  // Ensure web fonts (Playfair, Sacramento, Suisse) are ready before capture.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const width = node.offsetWidth;
  const height = node.offsetHeight;

  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    width,
    height,
    cacheBust: true,
    backgroundColor: '#F6F5F0',
    style: {
      // neutralise any transform applied by the responsive preview wrapper
      transform: 'none',
      margin: '0',
    },
  });

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  pdf.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
  pdf.save(`${sanitizeFilename(filename)}.pdf`);
}
