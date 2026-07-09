/**
 * THER-009 tests for the staff bulk-import parsing/validation core.
 * Covers: valid rows, invalid emails, in-file duplicates, already-known
 * members/invites, header detection, blank rows, the row cap, and empty input.
 */
import { describe, it, expect } from 'vitest';
import {
  extractStaffEmailsFromRows,
  buildStaffCsvTemplate,
  extractManagerInvitesFromRows,
  buildManagerCsvTemplate,
  buildWorkerCsvTemplate,
  STAFF_CSV_EMAIL_HEADER,
  MANAGER_CSV_ROLE_HEADER,
} from './staff-csv';

const MANAGER_ROLES = new Set(['supervisor', 'hr', 'clinical_director', 'finance']);
const WORKER_ROLES = new Set([
  'psychiatrist_prescriber',
  'nurse',
  'therapist_clinician',
  'case_manager',
  'behavioral_health_technician',
  'peer_support_specialist',
  'front_desk_admin',
  'facilities_support',
]);

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

describe('extractManagerInvitesFromRows — header detection & valid rows', () => {
  it('reads email + role header columns in the given order', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['email', 'role'],
        ['alice@example.com', 'hr'],
        ['bob@example.com', 'finance'],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([
      { email: 'alice@example.com', role: 'hr' },
      { email: 'bob@example.com', role: 'finance' },
    ]);
    expect(result.invalidEmailCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  it('detects the header columns in either order (role before email)', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['role', 'email'],
        ['hr', 'alice@example.com'],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([{ email: 'alice@example.com', role: 'hr' }]);
  });

  it('normalises role tokens (case, spaces, hyphens) against the valid-role set', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['email', 'role'],
        ['alice@example.com', 'Clinical Director'],
        ['bob@example.com', 'CLINICAL-DIRECTOR'],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([
      { email: 'alice@example.com', role: 'clinical_director' },
      { email: 'bob@example.com', role: 'clinical_director' },
    ]);
  });

  it('treats the first two columns as email/role when no header row is present', () => {
    const result = extractManagerInvitesFromRows([['alice@example.com', 'hr']], {
      validRoles: MANAGER_ROLES,
    });

    expect(result.invites).toEqual([{ email: 'alice@example.com', role: 'hr' }]);
  });
});

describe('extractManagerInvitesFromRows — missing/bad role values', () => {
  it('yields an empty role ("") for a blank role cell rather than an error', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['email', 'role'],
        ['alice@example.com', ''],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([{ email: 'alice@example.com', role: '' }]);
    expect(result.invalidEmailCount).toBe(0);
  });

  it('yields an empty role for an unrecognised role value (e.g. a worker role or garbage)', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['email', 'role'],
        ['alice@example.com', 'nurse'],
        ['bob@example.com', 'owner'],
        ['carol@example.com', 'super-admin'],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([
      { email: 'alice@example.com', role: '' },
      { email: 'bob@example.com', role: '' },
      { email: 'carol@example.com', role: '' },
    ]);
  });

  it('handles a file with no role column at all — every row gets an empty role', () => {
    const result = extractManagerInvitesFromRows(
      [['email'], ['alice@example.com'], ['bob@example.com']],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([
      { email: 'alice@example.com', role: '' },
      { email: 'bob@example.com', role: '' },
    ]);
  });
});

describe('extractManagerInvitesFromRows — invalid emails, duplicates, blank rows', () => {
  it('excludes malformed emails and counts them separately from duplicates', () => {
    const result = extractManagerInvitesFromRows(
      [
        ['email', 'role'],
        ['good@example.com', 'hr'],
        ['not-an-email', 'hr'],
        ['good@example.com', 'finance'],
      ],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toEqual([{ email: 'good@example.com', role: 'hr' }]);
    expect(result.invalidEmailCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
  });

  it('ignores fully-blank rows without counting them', () => {
    const result = extractManagerInvitesFromRows(
      [['email', 'role'], ['alice@example.com', 'hr'], [''], [null, undefined]],
      { validRoles: MANAGER_ROLES },
    );

    expect(result.invites).toHaveLength(1);
  });

  it('returns an empty result for an empty file', () => {
    const result = extractManagerInvitesFromRows([], { validRoles: MANAGER_ROLES });

    expect(result).toEqual({
      invites: [],
      invalidEmailCount: 0,
      duplicateCount: 0,
      truncated: false,
    });
  });
});

describe('extractManagerInvitesFromRows — row cap', () => {
  it('truncates at maxRows and reports it', () => {
    const rows = Array.from({ length: 5 }, (_, i) => [`user${i}@example.com`, 'hr']);
    const result = extractManagerInvitesFromRows(rows, { validRoles: MANAGER_ROLES, maxRows: 3 });

    expect(result.invites).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});

describe('buildManagerCsvTemplate', () => {
  it('starts with the expected email,role header', () => {
    const [header] = buildManagerCsvTemplate().split('\n');
    expect(header).toBe(`${STAFF_CSV_EMAIL_HEADER},${MANAGER_CSV_ROLE_HEADER}`);
  });
});

describe('buildWorkerCsvTemplate', () => {
  it('starts with the expected email,role header', () => {
    const [header] = buildWorkerCsvTemplate().split('\n');
    expect(header).toBe(`${STAFF_CSV_EMAIL_HEADER},${MANAGER_CSV_ROLE_HEADER}`);
  });

  it('round-trips through extractManagerInvitesFromRows with every sample role recognised', () => {
    const rows = buildWorkerCsvTemplate()
      .trim()
      .split('\n')
      .map((line) => line.split(','));

    const result = extractManagerInvitesFromRows(rows, { validRoles: WORKER_ROLES });

    expect(result.invites).toHaveLength(3);
    expect(result.invalidEmailCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
    for (const invite of result.invites) {
      expect(invite.role).not.toBe('');
      expect(WORKER_ROLES.has(invite.role)).toBe(true);
    }
    expect(result.invites.map((i) => i.email)).toEqual([
      'worker1@example.com',
      'worker2@example.com',
      'worker3@example.com',
    ]);
  });
});
