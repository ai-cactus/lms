/**
 * Certificate PDF generator using PDFKit (pure Node.js, no browser DOM required).
 * This replaces the previous @react-pdf/renderer implementation which required
 * browser-only APIs (DOMMatrix, Path2D) incompatible with Next.js SSR builds.
 */
import PDFDocument from 'pdfkit';

export interface CertificateData {
  studentName: string;
  courseName: string;
  issueDate: string;
  organizationName?: string;
  certificateId: string;
}

/**
 * Generates a PDF certificate as a Buffer.
 * Uses PDFKit which runs natively in Node.js without browser polyfills.
 */
export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // A4 landscape
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 40;

    // ── Outer border ─────────────────────────────────────────────────────────
    doc
      .rect(margin, margin, pageWidth - margin * 2, pageHeight - margin * 2)
      .lineWidth(6)
      .strokeColor('#1E40AF')
      .stroke();

    // ── Inner border ─────────────────────────────────────────────────────────
    doc
      .rect(margin + 12, margin + 12, pageWidth - (margin + 12) * 2, pageHeight - (margin + 12) * 2)
      .lineWidth(1.5)
      .strokeColor('#93C5FD')
      .stroke();

    // ── Header ───────────────────────────────────────────────────────────────
    doc
      .fontSize(40)
      .fillColor('#1E3A8A')
      .font('Helvetica-Bold')
      .text('CERTIFICATE OF COMPLETION', 0, 90, {
        align: 'center',
        characterSpacing: 2,
      });

    // ── Sub-header ───────────────────────────────────────────────────────────
    doc
      .moveDown(0.6)
      .fontSize(18)
      .font('Helvetica')
      .fillColor('#4B5563')
      .text('This is to certify that', { align: 'center' });

    // ── Student name ─────────────────────────────────────────────────────────
    doc
      .moveDown(0.8)
      .fontSize(30)
      .font('Helvetica-Bold')
      .fillColor('#111827')
      .text(data.studentName, { align: 'center', underline: false });

    // Underline below name
    const nameY = doc.y + 6;
    const lineWidth = 380;
    doc
      .moveTo((pageWidth - lineWidth) / 2, nameY)
      .lineTo((pageWidth + lineWidth) / 2, nameY)
      .lineWidth(1)
      .strokeColor('#D1D5DB')
      .stroke();

    // ── Course label ─────────────────────────────────────────────────────────
    doc
      .moveDown(1.4)
      .fontSize(16)
      .font('Helvetica')
      .fillColor('#4B5563')
      .text('has successfully completed the course', { align: 'center' });

    // ── Course name ──────────────────────────────────────────────────────────
    doc
      .moveDown(0.6)
      .fontSize(22)
      .font('Helvetica-Bold')
      .fillColor('#1E40AF')
      .text(data.courseName, { align: 'center', width: pageWidth - 160 });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = pageHeight - margin - 80;
    const footerLineY = footerY - 10;

    doc
      .moveTo(margin + 50, footerLineY)
      .lineTo(pageWidth - margin - 50, footerLineY)
      .lineWidth(0.5)
      .strokeColor('#E5E7EB')
      .stroke();

    // Date column (left)
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#6B7280')
      .text('Date of Completion', margin + 60, footerY, { width: 200, align: 'center' });

    doc
      .fontSize(13)
      .font('Helvetica-Bold')
      .fillColor('#374151')
      .text(data.issueDate, margin + 60, footerY + 18, { width: 200, align: 'center' });

    // Org column (right) — only if provided
    if (data.organizationName) {
      doc
        .fontSize(11)
        .font('Helvetica')
        .fillColor('#6B7280')
        .text('Issued By', pageWidth - margin - 260, footerY, { width: 200, align: 'center' });

      doc
        .fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#374151')
        .text(data.organizationName, pageWidth - margin - 260, footerY + 18, {
          width: 200,
          align: 'center',
        });
    }

    // ── Certificate ID watermark ──────────────────────────────────────────────
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#9CA3AF')
      .text(`ID: ${data.certificateId}`, pageWidth - margin - 180, pageHeight - margin - 30, {
        width: 170,
        align: 'right',
      });

    doc.end();
  });
}
