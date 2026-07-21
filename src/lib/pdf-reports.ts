/**
 * pdf-reports.ts
 *
 * Server-side PDF report generator using PDFKit.
 * Produces formatted user activity reports that match the sample layout:
 *   • Header: Report title + generated timestamp
 *   • Table: Course ID | Title | Type | Category | Grade | Date Assigned | Date Completed
 *   • Footer: Learner name (left) · Organisation (right) · Page n of N (centre)
 */

import PDFDocument from 'pdfkit';

export interface ActivityReportEnrollment {
  courseId: string;
  courseTitle: string;
  type: string; // e.g. "Course"
  category: string | null;
  score: number | null;
  dateAssigned: Date; // maps to enrollment.startedAt
  dateCompleted: Date | null;
  status: string;
}

export interface UserActivityReportData {
  userName: string;
  orgName: string;
  generatedAt: Date;
  enrollments: ActivityReportEnrollment[];
}

const MARGIN = 48;
const PAGE_WIDTH = 841.89; // A4 landscape width in points
const PAGE_HEIGHT = 595.28; // A4 landscape height in points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLUMNS: {
  key:
    | keyof ActivityReportEnrollment
    | 'scoreDisplay'
    | 'dateAssignedDisplay'
    | 'dateCompletedDisplay';
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}[] = [
  { key: 'courseId', label: 'Course ID', width: 110, align: 'left' },
  { key: 'courseTitle', label: 'Title', width: 200, align: 'left' },
  { key: 'type', label: 'Type', width: 60, align: 'left' },
  { key: 'category', label: 'Category', width: 90, align: 'left' },
  { key: 'scoreDisplay', label: 'Grade', width: 50, align: 'right' },
  { key: 'dateAssignedDisplay', label: 'Date Assigned', width: 90, align: 'center' },
  { key: 'dateCompletedDisplay', label: 'Date Completed', width: 95, align: 'center' },
];

const BRAND_BLUE = '#4C6EF5';
const HEADER_BG = '#F0F4FF';
const ROW_ALT_BG = '#F8FAFC';
const TEXT_DARK = '#1A202C';
const TEXT_MUTED = '#718096';
const BORDER_COLOUR = '#E2E8F0';

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatScore(score: number | null): string {
  if (score === null || score === undefined) return '—';
  return String(score);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function resolveCell(
  enrollment: ActivityReportEnrollment,
  key: (typeof COLUMNS)[number]['key'],
): string {
  switch (key) {
    case 'courseId':
      return truncate(enrollment.courseId, 18);
    case 'courseTitle':
      return truncate(enrollment.courseTitle, 40);
    case 'type':
      return enrollment.type;
    case 'category':
      return truncate(enrollment.category || '—', 18);
    case 'scoreDisplay':
      return formatScore(enrollment.score);
    case 'dateAssignedDisplay':
      return formatDate(enrollment.dateAssigned);
    case 'dateCompletedDisplay':
      return formatDate(enrollment.dateCompleted);
    default:
      return '';
  }
}

export async function generateUserActivityPdf(data: UserActivityReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_HEIGHT, PAGE_WIDTH], // landscape A4
      margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: `User Learning — ${data.userName}`,
        Author: 'Theraptly LMS',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => {
      // Stamp total page count after all pages are buffered
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        drawFooter(doc, data.userName, data.orgName, i + 1, totalPages);
      }
      doc.flushPages();
      resolve(Buffer.concat(buffers));
    });

    const ROW_HEIGHT = 20;
    const HEADER_HEIGHT = 22;
    const tableTop = 180; // y-position where the table starts on page 1
    const tableTopSubsequent = MARGIN + 20;
    const usableHeight = PAGE_HEIGHT - MARGIN - 60; // leave room for footer

    let currentY = tableTop;
    let pageIndex = 0;

    const addPage = () => {
      doc.addPage();
      pageIndex++;
      currentY = tableTopSubsequent;
      drawPageHeader(doc, data, pageIndex === 0);
      drawTableHeader(doc, currentY);
      currentY += HEADER_HEIGHT;
    };

    doc.addPage();
    drawPageHeader(doc, data, true);
    drawTableHeader(doc, currentY);
    currentY += HEADER_HEIGHT;

    data.enrollments.forEach((enrollment, idx) => {
      if (currentY + ROW_HEIGHT > usableHeight) {
        addPage();
      }
      drawRow(doc, enrollment, currentY, idx % 2 === 1);
      currentY += ROW_HEIGHT;
    });

    doc.end();
  });
}

function drawPageHeader(doc: PDFKit.PDFDocument, data: UserActivityReportData, isFirst: boolean) {
  if (!isFirst) return; // Subsequent pages just have the table header

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(TEXT_DARK)
    .text(`User Learning — ${data.userName}`, MARGIN, MARGIN, { width: CONTENT_WIDTH });

  const ts = data.generatedAt.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TEXT_MUTED)
    .text(ts, MARGIN, MARGIN + 28, { width: CONTENT_WIDTH });

  doc
    .moveTo(MARGIN, MARGIN + 46)
    .lineTo(MARGIN + CONTENT_WIDTH, MARGIN + 46)
    .strokeColor(BORDER_COLOUR)
    .lineWidth(0.5)
    .stroke();
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(MARGIN, y, CONTENT_WIDTH, 22).fillColor(HEADER_BG).fill();

  doc
    .moveTo(MARGIN, y + 22)
    .lineTo(MARGIN + CONTENT_WIDTH, y + 22)
    .strokeColor(BRAND_BLUE)
    .lineWidth(0.8)
    .stroke();

  let x = MARGIN;
  COLUMNS.forEach((col) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(TEXT_DARK)
      .text(col.label, x + 4, y + 7, {
        width: col.width - 8,
        align: col.align,
        lineBreak: false,
      });
    x += col.width;
  });
}

function drawRow(
  doc: PDFKit.PDFDocument,
  enrollment: ActivityReportEnrollment,
  y: number,
  isAlt: boolean,
) {
  if (isAlt) {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 20).fillColor(ROW_ALT_BG).fill();
  }

  doc
    .moveTo(MARGIN, y + 20)
    .lineTo(MARGIN + CONTENT_WIDTH, y + 20)
    .strokeColor(BORDER_COLOUR)
    .lineWidth(0.3)
    .stroke();

  let x = MARGIN;
  COLUMNS.forEach((col) => {
    const text = resolveCell(enrollment, col.key);
    let colour = TEXT_DARK;
    if (col.key === 'type') colour = BRAND_BLUE;
    if (col.key === 'category') colour = '#553C9A'; // purple accent

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(colour)
      .text(text, x + 4, y + 6, {
        width: col.width - 8,
        align: col.align,
        lineBreak: false,
      });
    x += col.width;
  });
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  learnerName: string,
  orgName: string,
  page: number,
  total: number,
) {
  const y = PAGE_HEIGHT - 38;

  doc
    .moveTo(MARGIN, y - 6)
    .lineTo(MARGIN + CONTENT_WIDTH, y - 6)
    .strokeColor(BORDER_COLOUR)
    .lineWidth(0.5)
    .stroke();

  // Learner name (left)
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(TEXT_MUTED)
    .text(`Learner: ${learnerName}`, MARGIN, y, { width: CONTENT_WIDTH / 3, align: 'left' });

  // Page number (centre)
  doc.text(`${page} of ${total}`, MARGIN + CONTENT_WIDTH / 3, y, {
    width: CONTENT_WIDTH / 3,
    align: 'center',
  });

  // Organisation (right)
  doc.text(`Organization: ${orgName}`, MARGIN + (CONTENT_WIDTH * 2) / 3, y, {
    width: CONTENT_WIDTH / 3,
    align: 'right',
  });
}
