/**
 * Staff bulk-import (CSV / XLSX) parsing & validation utilities.
 *
 * Used by the Staff Management "Add Worker" dialog to let an admin bulk-invite
 * workers from a spreadsheet. The heavy validation logic lives in the pure
 * `extractStaffEmailsFromRows` function so it can be unit-tested without a real
 * file / DOM. `readStaffSpreadsheetRows` is the thin, side-effectful adapter
 * that turns an uploaded File into a matrix of cells.
 *
 * Invites are always submitted through the `createInvites` server action, which
 * derives org/role/inviter from the admin session — this module never assigns
 * roles or touches onboarding.
 */
import * as XLSX from 'xlsx';

/** Same email shape used by the manual invite-chip input, kept consistent. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Header label the downloadable template uses and the parser detects. */
export const STAFF_CSV_EMAIL_HEADER = 'email';

/**
 * Hard cap on the number of data rows processed from a single upload. Protects
 * the UI (and the downstream server action) from pathologically large files.
 */
export const MAX_STAFF_CSV_ROWS = 1000;

/**
 * Hard cap on the byte size of an uploaded spreadsheet before parsing. The file
 * is attacker-supplied, so we reject oversized inputs up front (defense in depth
 * against decompression/parse-amplification) rather than handing them to the
 * spreadsheet parser. 5 MB comfortably covers a {@link MAX_STAFF_CSV_ROWS}-row
 * email list.
 */
export const MAX_STAFF_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Per-row error reasons surfaced in the import preview. */
export type StaffCsvRowError =
  | 'Invalid email format'
  | 'Duplicate in file'
  | 'Already a member or invited';

export interface StaffCsvRow {
  /** The email as read (lowercased when valid, raw-trimmed when invalid). */
  email: string;
  valid: boolean;
  /** Present only for invalid rows. */
  error?: StaffCsvRowError;
}

export interface StaffCsvParseResult {
  /** Per-row results in file order, excluding fully-blank rows. */
  rows: StaffCsvRow[];
  /** Unique, lowercased, importable emails (valid + not already known). */
  validEmails: string[];
  /** Count of non-blank data rows considered (excludes the header row). */
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  /** True when the file exceeded {@link MAX_STAFF_CSV_ROWS} and was truncated. */
  truncated: boolean;
}

interface ExtractOptions {
  /**
   * Lowercased emails already present as members or pending invites. Matching
   * rows are flagged rather than re-sent. Detection is best-effort/client-side;
   * the server action remains the source of truth.
   */
  knownEmails?: Set<string>;
  /** Override the row cap (primarily for tests). */
  maxRows?: number;
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

/**
 * Pure validation core: turns a matrix of spreadsheet cells into a per-row,
 * deduplicated import preview. Detects an optional `email` header row (and
 * which column it sits in); when no header is present, the first column is
 * treated as the email column.
 */
export function extractStaffEmailsFromRows(
  rows: unknown[][],
  options: ExtractOptions = {},
): StaffCsvParseResult {
  const maxRows = options.maxRows ?? MAX_STAFF_CSV_ROWS;
  const knownEmails = options.knownEmails ?? new Set<string>();

  // Locate the first non-blank row to decide header/column layout.
  let emailCol = 0;
  let dataStartIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (!row.some((cell) => cellToString(cell) !== '')) continue;

    const headerIdx = row.findIndex(
      (cell) => cellToString(cell).toLowerCase() === STAFF_CSV_EMAIL_HEADER,
    );
    if (headerIdx !== -1) {
      emailCol = headerIdx;
      dataStartIndex = i + 1;
    } else {
      emailCol = 0;
      dataStartIndex = i;
    }
    break;
  }

  const result: StaffCsvRow[] = [];
  const validEmails: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  let truncated = false;

  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    const raw = Array.isArray(row) ? cellToString(row[emailCol]) : '';
    if (raw === '') continue; // Skip blank rows entirely — not counted.

    if (result.length >= maxRows) {
      truncated = true;
      break;
    }

    const lower = raw.toLowerCase();

    if (!EMAIL_REGEX.test(raw)) {
      result.push({ email: raw, valid: false, error: 'Invalid email format' });
      continue;
    }
    if (seen.has(lower)) {
      duplicateCount++;
      result.push({ email: lower, valid: false, error: 'Duplicate in file' });
      continue;
    }
    if (knownEmails.has(lower)) {
      result.push({ email: lower, valid: false, error: 'Already a member or invited' });
      continue;
    }

    seen.add(lower);
    validEmails.push(lower);
    result.push({ email: lower, valid: true });
  }

  const validCount = validEmails.length;
  return {
    rows: result,
    validEmails,
    totalRows: result.length,
    validCount,
    invalidCount: result.length - validCount,
    duplicateCount,
    truncated,
  };
}

/**
 * Reads an uploaded `.csv` / `.xlsx` file into a matrix of raw cell values.
 * Side-effectful (File I/O); the pure validation happens in
 * {@link extractStaffEmailsFromRows}.
 *
 * The file is untrusted (attacker-supplied): its size is validated before
 * parsing and the parse is wrapped so a malformed/corrupt spreadsheet surfaces a
 * clear error instead of leaking parser internals. Throws {@link Error} with a
 * user-safe message on either failure.
 */
export async function readStaffSpreadsheetRows(file: File): Promise<unknown[][]> {
  if (file.size > MAX_STAFF_UPLOAD_BYTES) {
    throw new Error('File is too large. Please upload a spreadsheet under 5 MB.');
  }

  const data = await file.arrayBuffer();

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array' });
  } catch {
    throw new Error('Could not read the file. Please upload a valid CSV or XLSX spreadsheet.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
}

/** Small CSV template contents with the expected header and sample rows. */
export function buildStaffCsvTemplate(): string {
  return `${STAFF_CSV_EMAIL_HEADER}\nworker1@example.com\nworker2@example.com\n`;
}
