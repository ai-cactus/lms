/**
 * Server-side certificate PDF generator (PDFKit, pure Node.js — no browser DOM).
 *
 * This produces the certificate that is persisted at issuance time and served
 * from `/api/certificates/[id]` (e.g. when the verification QR code is scanned).
 * The user-facing "Export PDF" in the app is rendered client-side from the
 * `CertificateDocument` component (pixel-exact WYSIWYG); this server renderer
 * mirrors that design — cream paper, left-aligned body, gold accents, footer —
 * as closely as PDFKit's primitives allow so the stored artifact stays on brand.
 */
import PDFDocument from 'pdfkit';
import { readFileSync } from 'fs';
import path from 'path';

// Pre-rasterised gold seal (matches the on-screen `CertificateDocument`). Read
// once at module load; if the asset is missing we simply omit the seal.
let SEAL_PNG: Buffer | null = null;
try {
  SEAL_PNG = readFileSync(path.join(process.cwd(), 'public/images/certificate-seal.png'));
} catch {
  SEAL_PNG = null;
}

export interface CertificateData {
  studentName: string;
  courseName: string;
  issueDate: string;
  organizationName?: string;
  certificateId: string;
}

const COLORS = {
  paper: '#F6F5F0',
  dashed: '#D8D5CB',
  ink: '#1A1A1A',
  navy: '#163139',
  body: '#5B5B58',
  gold: '#A98B53',
  blue: '#0066FF',
};

/** Generates a PDF certificate as a Buffer (A4 landscape). */
export async function generateCertificatePDF(data: CertificateData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = doc.page.width;
    const H = doc.page.height;
    const pad = 60;

    // ── Cream paper ──────────────────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(COLORS.paper);

    // ── Dashed inner frame ─────────────────────────────────────────────────────
    doc
      .save()
      .lineWidth(1)
      .dash(3, { space: 3 })
      .strokeColor(COLORS.dashed)
      .rect(22, 22, W - 44, H - 44)
      .stroke()
      .undash()
      .restore();

    // ── Heading (top-left) ─────────────────────────────────────────────────────
    doc
      .font('Helvetica')
      .fontSize(16)
      .fillColor(COLORS.gold)
      .text('CERTIFICATE OF', pad, 64, { characterSpacing: 3 });
    doc.font('Helvetica-Bold').fontSize(42).fillColor(COLORS.ink).text('COMPLETION', pad, 84);

    // ── Wordmark (top-right) ───────────────────────────────────────────────────
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(COLORS.ink)
      .text('Theraptly', W - pad - 220, 70, { width: 220, align: 'right' });

    // ── Gold seal (rasterised real artwork, right) ─────────────────────────────
    if (SEAL_PNG) {
      const sealW = 126;
      doc.image(SEAL_PNG, W - pad - sealW - 6, 150, { width: sealW });
    }

    // ── Body (left-aligned) ────────────────────────────────────────────────────
    const bodyW = 470;
    let y = 250;

    doc
      .font('Helvetica')
      .fontSize(13)
      .fillColor(COLORS.body)
      .text('This is to certify that', pad, y);
    y += 28;
    doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.navy).text(data.studentName, pad, y, {
      width: bodyW,
    });
    y = doc.y + 18;
    doc
      .font('Helvetica')
      .fontSize(13)
      .fillColor(COLORS.body)
      .text('successfully completed and received a passing grade in', pad, y);
    y += 26;
    doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.navy).text(data.courseName, pad, y, {
      width: bodyW,
    });
    y = doc.y + 18;

    doc.font('Helvetica').fontSize(13).fillColor(COLORS.body);
    doc.text('a course of study offered by ', pad, y, { width: bodyW, continued: true });
    doc
      .font('Helvetica-Bold')
      .fillColor(COLORS.navy)
      .text(data.organizationName || 'the organization', {
        continued: true,
      });
    doc
      .font('Helvetica')
      .fillColor(COLORS.body)
      .text(', showcasing your commitment to excellence, innovation, and teamwork.');

    // ── Footer — metadata ──────────────────────────────────────────────────────
    // "Presented on" sits bottom-left; "Valid certificate ID" bottom-right.
    const footY = H - pad - 52;
    const idColW = 240;

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.gold)
      .text('PRESENTED ON', pad, footY, { characterSpacing: 1 });
    doc
      .font('Helvetica')
      .fontSize(15)
      .fillColor(COLORS.ink)
      .text(data.issueDate, pad, footY + 14);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.gold)
      .text('VALID CERTIFICATE ID', W - pad - idColW, footY, {
        width: idColW,
        align: 'right',
        characterSpacing: 1,
      });
    doc
      .font('Helvetica')
      .fontSize(15)
      .fillColor(COLORS.ink)
      .text(data.certificateId, W - pad - idColW, footY + 14, { width: idColW, align: 'right' });

    doc.end();
  });
}
