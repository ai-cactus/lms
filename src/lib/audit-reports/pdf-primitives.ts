// Generic PDFKit drawing helpers shared by all audit report renderers.
import PDFDocument from 'pdfkit';

export const MARGIN = 48;
export const PAGE_WIDTH = 841.89; // A4 landscape
export const PAGE_HEIGHT = 595.28;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const BRAND_BLUE = '#4C6EF5';
export const HEADER_BG = '#F0F4FF';
export const ROW_ALT_BG = '#F8FAFC';
export const TEXT_DARK = '#1A202C';
export const TEXT_MUTED = '#718096';
export const BORDER_COLOUR = '#E2E8F0';

export type Doc = PDFKit.PDFDocument;

export interface Column<T> {
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
  value: (row: T) => string;
}

export function createDoc(title: string): Doc {
  return new PDFDocument({
    // PDFKit size is [width, height]; we want A4 landscape (wide).
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
    autoFirstPage: false,
    bufferPages: true,
    info: { Title: title, Author: 'Theraptly LMS' },
  });
}

export function finalize(doc: Doc, orgName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];
    doc.on('data', (c: Buffer) => buffers.push(c));
    doc.on('error', reject);
    doc.on('end', () => {
      const total = doc.bufferedPageRange().count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(i);
        drawFooter(doc, orgName, i + 1, total);
      }
      doc.flushPages();
      resolve(Buffer.concat(buffers));
    });
    doc.end();
  });
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

export function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}

export function drawTitle(doc: Doc, title: string, subtitle: string, y: number): number {
  doc.font('Helvetica-Bold').fontSize(18).fillColor(TEXT_DARK).text(title, MARGIN, y, {
    width: CONTENT_WIDTH,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TEXT_MUTED)
    .text(subtitle, MARGIN, y + 26, { width: CONTENT_WIDTH });
  doc
    .moveTo(MARGIN, y + 44)
    .lineTo(MARGIN + CONTENT_WIDTH, y + 44)
    .strokeColor(BORDER_COLOUR)
    .lineWidth(0.5)
    .stroke();
  return y + 58;
}

export function drawSectionHeading(doc: Doc, text: string, y: number): number {
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND_BLUE).text(text, MARGIN, y, {
    width: CONTENT_WIDTH,
  });
  return y + 20;
}

/** Two-column key/value block (e.g. course metadata). Returns the new y. */
export function drawKeyValues(doc: Doc, pairs: [string, string][], y: number): number {
  let curY = y;
  pairs.forEach(([k, v]) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_MUTED).text(k, MARGIN, curY, {
      width: 140,
      lineBreak: false,
    });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(TEXT_DARK)
      .text(v, MARGIN + 150, curY, {
        width: CONTENT_WIDTH - 150,
      });
    curY += 16;
  });
  return curY + 6;
}

/**
 * Paginated table. Adds pages as needed; each new page restarts the table
 * header. Returns the final y on the last page.
 */
export function drawTable<T>(doc: Doc, columns: Column<T>[], rows: T[], startY: number): number {
  const ROW_H = 20;
  const HEADER_H = 22;
  const usableBottom = PAGE_HEIGHT - MARGIN - 60;

  const header = (y: number) => {
    doc.rect(MARGIN, y, CONTENT_WIDTH, HEADER_H).fillColor(HEADER_BG).fill();
    doc
      .moveTo(MARGIN, y + HEADER_H)
      .lineTo(MARGIN + CONTENT_WIDTH, y + HEADER_H)
      .strokeColor(BRAND_BLUE)
      .lineWidth(0.8)
      .stroke();
    let x = MARGIN;
    columns.forEach((c) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(TEXT_DARK)
        .text(c.label, x + 4, y + 7, {
          width: c.width - 8,
          align: c.align,
          lineBreak: false,
        });
      x += c.width;
    });
    return y + HEADER_H;
  };

  let y = header(startY);
  rows.forEach((row, idx) => {
    if (y + ROW_H > usableBottom) {
      doc.addPage();
      y = header(MARGIN + 20);
    }
    if (idx % 2 === 1) {
      doc.rect(MARGIN, y, CONTENT_WIDTH, ROW_H).fillColor(ROW_ALT_BG).fill();
    }
    doc
      .moveTo(MARGIN, y + ROW_H)
      .lineTo(MARGIN + CONTENT_WIDTH, y + ROW_H)
      .strokeColor(BORDER_COLOUR)
      .lineWidth(0.3)
      .stroke();
    let x = MARGIN;
    columns.forEach((c) => {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(TEXT_DARK)
        .text(c.value(row), x + 4, y + 6, {
          width: c.width - 8,
          align: c.align,
          lineBreak: false,
        });
      x += c.width;
    });
    y += ROW_H;
  });
  return y;
}

/** Ensure at least `needed` vertical space remains; else new page. Returns y. */
export function ensureSpace(doc: Doc, y: number, needed: number): number {
  const usableBottom = PAGE_HEIGHT - MARGIN - 60;
  if (y + needed > usableBottom) {
    doc.addPage();
    return MARGIN + 20;
  }
  return y;
}

function drawFooter(doc: Doc, orgName: string, page: number, total: number) {
  const y = PAGE_HEIGHT - 38;
  doc
    .moveTo(MARGIN, y - 6)
    .lineTo(MARGIN + CONTENT_WIDTH, y - 6)
    .strokeColor(BORDER_COLOUR)
    .lineWidth(0.5)
    .stroke();
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text(`Theraptly LMS — Audit Report`, MARGIN, y, { width: CONTENT_WIDTH / 3, align: 'left' });
  doc.text(`${page} of ${total}`, MARGIN + CONTENT_WIDTH / 3, y, {
    width: CONTENT_WIDTH / 3,
    align: 'center',
  });
  doc.text(`Organization: ${orgName}`, MARGIN + (CONTENT_WIDTH * 2) / 3, y, {
    width: CONTENT_WIDTH / 3,
    align: 'right',
  });
}
