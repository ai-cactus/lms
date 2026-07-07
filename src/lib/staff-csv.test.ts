/**
 * THER-009 tests for the staff bulk-import parsing/validation core.
 * Covers: valid rows, invalid emails, in-file duplicates, already-known
 * members/invites, header detection, blank rows, the row cap, and empty input.
 */
import { describe, it, expect } from 'vitest';
import {
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
  STAFF_CSV_EMAIL_HEADER,
} from './staff-csv';

describe('extractStaffEmailsFromRows — header detection & valid rows', () => {
  it('skips an `email` header row and imports the valid emails below it', () => {
    const result = extractStaffEmailsFromRows([
      ['email'],
      ['alice@example.com'],
      ['bob@example.com'],
    ]);

    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(result.totalRows).toBe(2);
    expect(result.rows.every((r) => r.valid)).toBe(true);
  });

  it('treats the first column as email when no header is present', () => {
    const result = extractStaffEmailsFromRows([['alice@example.com'], ['bob@example.com']]);

    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.validCount).toBe(2);
  });

  it('uses the header column position when `email` is not the first column', () => {
    const result = extractStaffEmailsFromRows([
      ['name', 'email'],
      ['Alice', 'alice@example.com'],
    ]);

    expect(result.validEmails).toEqual(['alice@example.com']);
  });

  it('lowercases and trims valid emails', () => {
    const result = extractStaffEmailsFromRows([['  Alice@Example.com  ']]);

    expect(result.validEmails).toEqual(['alice@example.com']);
    expect(result.rows[0]).toEqual({ email: 'alice@example.com', valid: true });
  });
});

describe('extractStaffEmailsFromRows — invalid emails', () => {
  it('flags malformed emails with an error and excludes them from validEmails', () => {
    const result = extractStaffEmailsFromRows([
      ['email'],
      ['good@example.com'],
      ['not-an-email'],
      ['also bad@nope'],
    ]);

    expect(result.validEmails).toEqual(['good@example.com']);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(2);
    expect(result.rows[1]).toEqual({
      email: 'not-an-email',
      valid: false,
      error: 'Invalid email format',
    });
  });
});

describe('extractStaffEmailsFromRows — duplicates', () => {
  it('keeps the first occurrence and flags later case-insensitive duplicates', () => {
    const result = extractStaffEmailsFromRows([
      ['alice@example.com'],
      ['ALICE@example.com'],
      ['alice@example.com'],
    ]);

    expect(result.validEmails).toEqual(['alice@example.com']);
    expect(result.validCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.rows[1].error).toBe('Duplicate in file');
    expect(result.rows[2].error).toBe('Duplicate in file');
  });
});

describe('extractStaffEmailsFromRows — already-known members/invites', () => {
  it('flags emails already present as members or pending invites', () => {
    const result = extractStaffEmailsFromRows([['alice@example.com'], ['bob@example.com']], {
      knownEmails: new Set(['bob@example.com']),
    });

    expect(result.validEmails).toEqual(['alice@example.com']);
    expect(result.rows[1]).toEqual({
      email: 'bob@example.com',
      valid: false,
      error: 'Already a member or invited',
    });
  });
});

describe('extractStaffEmailsFromRows — blank rows & empty input', () => {
  it('returns an empty result for an empty file', () => {
    const result = extractStaffEmailsFromRows([]);

    expect(result).toEqual({
      rows: [],
      validEmails: [],
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      truncated: false,
    });
  });

  it('returns an empty result for a header-only file', () => {
    const result = extractStaffEmailsFromRows([['email']]);

    expect(result.totalRows).toBe(0);
    expect(result.validEmails).toEqual([]);
  });

  it('ignores fully-blank rows without counting them', () => {
    const result = extractStaffEmailsFromRows([
      ['email'],
      ['alice@example.com'],
      [''],
      [null],
      ['bob@example.com'],
    ]);

    expect(result.totalRows).toBe(2);
    expect(result.validEmails).toEqual(['alice@example.com', 'bob@example.com']);
  });
});

describe('extractStaffEmailsFromRows — row cap', () => {
  it('truncates at maxRows and reports it', () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`user${i}@example.com`]);
    const result = extractStaffEmailsFromRows(rows, { maxRows: 3 });

    expect(result.totalRows).toBe(3);
    expect(result.validEmails).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe('buildStaffCsvTemplate', () => {
  it('starts with the expected header', () => {
    expect(buildStaffCsvTemplate().split('\n')[0]).toBe(STAFF_CSV_EMAIL_HEADER);
  });
});
