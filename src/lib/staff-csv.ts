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
 */
export async function readStaffSpreadsheetRows(file: File): Promise<unknown[][]> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
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

/** Header label the manager template uses and the manager parser detects. */
export const MANAGER_CSV_ROLE_HEADER = 'role';

export interface ManagerCsvInvite {
  /** Lowercased, valid email. */
  email: string;
  /**
   * Matched manager role value (e.g. `hr`), or `''` when the row's role cell is
   * blank/unrecognised — the UI prompts the admin to pick one in that case.
   */
  role: string;
}

export interface ManagerCsvParseResult {
  /** Unique importable invites in file order (valid email, best-effort role). */
  invites: ManagerCsvInvite[];
  invalidEmailCount: number;
  duplicateCount: number;
  /** True when the file exceeded {@link MAX_STAFF_CSV_ROWS} and was truncated. */
  truncated: boolean;
}

interface ExtractManagerOptions {
  /**
   * Accepted manager role values (e.g. `new Set(['supervisor','hr',...])`).
   * A row's role cell is normalised (lowercased, spaces/hyphens → underscores)
   * and matched against this set; a miss yields an empty role rather than an
   * error, so the row is still importable.
   */
  validRoles: Set<string>;
  /** Override the row cap (primarily for tests). */
  maxRows?: number;
}

function normaliseRoleToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Manager-invite counterpart of {@link extractStaffEmailsFromRows}: reads an
 * `email` column plus an optional `role` column. Detects both header labels
 * (any order); with no header the first column is the email and the second is
 * the role. Roles are validated against the provided manager set — an
 * unrecognised or missing role becomes `''` (the admin assigns it in the UI).
 */
export function extractManagerInvitesFromRows(
  rows: unknown[][],
  options: ExtractManagerOptions,
): ManagerCsvParseResult {
  const maxRows = options.maxRows ?? MAX_STAFF_CSV_ROWS;
  const { validRoles } = options;

  let emailCol = 0;
  let roleCol = 1;
  let dataStartIndex = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    if (!row.some((cell) => cellToString(cell) !== '')) continue;

    const emailIdx = row.findIndex(
      (cell) => cellToString(cell).toLowerCase() === STAFF_CSV_EMAIL_HEADER,
    );
    const roleIdx = row.findIndex(
      (cell) => cellToString(cell).toLowerCase() === MANAGER_CSV_ROLE_HEADER,
    );
    if (emailIdx !== -1 || roleIdx !== -1) {
      emailCol = emailIdx !== -1 ? emailIdx : 0;
      roleCol = roleIdx !== -1 ? roleIdx : emailCol === 1 ? 0 : 1;
      dataStartIndex = i + 1;
    } else {
      emailCol = 0;
      roleCol = 1;
      dataStartIndex = i;
    }
    break;
  }

  const invites: ManagerCsvInvite[] = [];
  const seen = new Set<string>();
  let invalidEmailCount = 0;
  let duplicateCount = 0;
  let truncated = false;

  for (let i = dataStartIndex; i < rows.length; i++) {
    const row = rows[i];
    const rawEmail = Array.isArray(row) ? cellToString(row[emailCol]) : '';
    if (rawEmail === '') continue;

    if (invites.length + invalidEmailCount + duplicateCount >= maxRows) {
      truncated = true;
      break;
    }

    const lower = rawEmail.toLowerCase();
    if (!EMAIL_REGEX.test(rawEmail)) {
      invalidEmailCount++;
      continue;
    }
    if (seen.has(lower)) {
      duplicateCount++;
      continue;
    }

    const rawRole = Array.isArray(row) ? cellToString(row[roleCol]) : '';
    const token = normaliseRoleToken(rawRole);
    const role = validRoles.has(token) ? token : '';

    seen.add(lower);
    invites.push({ email: lower, role });
  }

  return { invites, invalidEmailCount, duplicateCount, truncated };
}

/** Manager CSV template: `email,role` header with sample rows. */
export function buildManagerCsvTemplate(): string {
  return `${STAFF_CSV_EMAIL_HEADER},${MANAGER_CSV_ROLE_HEADER}\nmanager1@example.com,hr\nmanager2@example.com,finance\n`;
}
