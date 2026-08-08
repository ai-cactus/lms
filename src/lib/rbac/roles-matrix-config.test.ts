/**
 * Unit tests for the Settings → Roles matrix config.
 *
 * The matrix is derived live from the RBAC registry (`permissions.ts`) via
 * `can()`, so these spot-checks double as a guard that the registry keeps giving
 * the expected shape (owner = everything, finance ≈ billing, workers ≈ nothing,
 * Settings = owner-only).
 */
import { describe, it, expect } from 'vitest';
import {
  canAccessModule,
  MATRIX_COLUMNS,
  MATRIX_ROWS,
  STUDENT_COLUMN_ROLE,
} from './roles-matrix-config';
import type { RoleKey } from './permissions';

const rowByLabel = (label: string) => {
  const row = MATRIX_ROWS.find((r) => r.label === label);
  if (!row) throw new Error(`No matrix row labelled "${label}"`);
  return row;
};

describe('MATRIX_COLUMNS', () => {
  it('exposes the six expected columns in order — Student column dropped, Admin added', () => {
    expect(MATRIX_COLUMNS.map((c) => c.key)).toEqual([
      'owner',
      'admin',
      'hr',
      'finance',
      'clinicalDirector',
      'supervisor',
    ]);
  });
});

describe('owner', () => {
  it('is allowed for every row', () => {
    for (const row of MATRIX_ROWS) {
      expect(row.check('owner'), `owner should pass "${row.label}"`).toBe(true);
    }
  });
});

describe('admin', () => {
  it('is Owner-equivalent — allowed for every row', () => {
    for (const row of MATRIX_ROWS) {
      expect(row.check('admin'), `admin should pass "${row.label}"`).toBe(true);
    }
  });
});

describe('finance', () => {
  it('holds billing access but not course-building or settings', () => {
    expect(rowByLabel('Billing').check('finance')).toBe(true);
    expect(rowByLabel('Manage billing & invoices').check('finance')).toBe(true);
    expect(rowByLabel('Build & edit courses').check('finance')).toBe(false);
    expect(rowByLabel('Manage staff roster').check('finance')).toBe(false);
    expect(rowByLabel('Settings').check('finance')).toBe(false);
  });

  it('is blocked from the Status Tracker (no roster-wide assignment visibility)', () => {
    expect(rowByLabel('Status Tracker').check('finance')).toBe(false);
  });
});

describe('student (representative worker role)', () => {
  it('is denied admin sections and actions', () => {
    expect(rowByLabel('Status Tracker').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Staff Management').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Billing').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Manage staff roster').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Settings').check(STUDENT_COLUMN_ROLE)).toBe(false);
  });

  it('may still read the Courses section (workers hold course.read)', () => {
    expect(rowByLabel('Courses').check(STUDENT_COLUMN_ROLE)).toBe(true);
  });

  it('sees the universal Dashboard and Help Center', () => {
    expect(rowByLabel('Dashboard').check(STUDENT_COLUMN_ROLE)).toBe(true);
    expect(rowByLabel('Help Center').check(STUDENT_COLUMN_ROLE)).toBe(true);
  });
});

describe('supervisor', () => {
  // Supervisor was demoted to READ-ONLY: every prior write-level action
  // (staff roster edits, invites, course authoring) is now denied.
  it('is read-only — denied every write-level action (staff roster, invites, course authoring)', () => {
    expect(rowByLabel('Manage staff roster').check('supervisor')).toBe(false);
    expect(rowByLabel('Invite & change user roles').check('supervisor')).toBe(false);
    expect(rowByLabel('Build & edit courses').check('supervisor')).toBe(false);
    // SUSPECTED BUG (left failing intentionally, see report): the ruling states
    // supervisor gets "no billing", but `readEverything` in permissions.ts grants
    // `billing.read` to every resource for every read-only role, including
    // supervisor, so this currently evaluates true. Not silently updated to
    // match observed behavior — flagged for human confirmation instead.
    expect(rowByLabel('Billing').check('supervisor')).toBe(false);
    expect(rowByLabel('Manage billing & invoices').check('supervisor')).toBe(false);
    expect(rowByLabel('Settings').check('supervisor')).toBe(false);
  });
});

describe('hr', () => {
  it('manages staff, invites and now courses, but cannot author clinical assessments or reach billing/settings', () => {
    expect(rowByLabel('Manage staff roster').check('hr')).toBe(true);
    expect(rowByLabel('Invite & change user roles').check('hr')).toBe(true);
    // HR gained full course CRUD per the updated ruling (previously blocked).
    expect(rowByLabel('Build & edit courses').check('hr')).toBe(true);
    expect(rowByLabel('Author clinical assessments').check('hr')).toBe(false);
    expect(rowByLabel('Billing').check('hr')).toBe(false);
    expect(rowByLabel('Settings').check('hr')).toBe(false);
  });
});

describe('clinicalDirector', () => {
  it('authors clinical content but cannot manage staff or billing', () => {
    expect(rowByLabel('Build & edit courses').check('clinicalDirector')).toBe(true);
    expect(rowByLabel('Author clinical assessments').check('clinicalDirector')).toBe(true);
    expect(rowByLabel('Manage staff roster').check('clinicalDirector')).toBe(false);
    expect(rowByLabel('Invite & change user roles').check('clinicalDirector')).toBe(false);
    expect(rowByLabel('Billing').check('clinicalDirector')).toBe(false);
    expect(rowByLabel('Settings').check('clinicalDirector')).toBe(false);
  });
});

describe('Settings row', () => {
  it('is owner-or-admin only', () => {
    const settings = rowByLabel('Settings');
    expect(settings.check('owner')).toBe(true);
    expect(settings.check('admin')).toBe(true);
    for (const column of MATRIX_COLUMNS) {
      if (column.key === 'owner' || column.key === 'admin') continue;
      expect(settings.check(column.key), `${column.key} must not access Settings`).toBe(false);
    }
  });
});

describe('Status Tracker row (assignment.read)', () => {
  it.each(['owner', 'supervisor', 'hr', 'clinicalDirector'] as const)(
    '%s can access the Status Tracker',
    (roleKey) => {
      expect(rowByLabel('Status Tracker').check(roleKey)).toBe(true);
    },
  );

  it.each(['finance', STUDENT_COLUMN_ROLE] as const)(
    '%s cannot access the Status Tracker',
    (roleKey) => {
      expect(rowByLabel('Status Tracker').check(roleKey)).toBe(false);
    },
  );
});

describe('universal navigation rows (Dashboard, Help Center)', () => {
  it.each(['Dashboard', 'Help Center'] as const)('%s is visible to every column', (label) => {
    for (const column of MATRIX_COLUMNS) {
      expect(rowByLabel(label).check(column.key), `${column.key} should see ${label}`).toBe(true);
    }
  });
});

describe('per-role NAVIGATION module list — exact assertions for owner/admin/4 manager roles + worker', () => {
  // Mirrors the authoritative access matrix: owner and admin see everything
  // (admin is Owner-equivalent); supervisor keeps read visibility everywhere
  // it held before (its demotion to read-only affects write actions, not this
  // NAVIGATION list) except Billing/Settings; hr keeps Staff Management
  // (retains user.read) and now also reads/authors Courses; clinicalDirector
  // LOSES Staff Management (no more user.read — no Staff module at all per the
  // ruling); finance LOSES Staff Management too (lost user.read) and trades
  // Documents/Status Tracker for Billing; the worker representative only holds
  // the three universally-readable modules.
  //
  // NOTE: supervisor intentionally omits 'Billing' here even though the live
  // registry currently grants it (see the suspected-bug callout in the
  // 'supervisor' describe block above) — not widened to match the
  // implementation until a human confirms the ruling's "no billing" intent.
  const NAVIGATION_LABELS = [
    'Dashboard',
    'Documents',
    'Courses',
    'Status Tracker',
    'Staff Management',
    'Billing',
    'Settings',
    'Help Center',
  ] as const;

  const ROLE_MODULE_EXPECTATIONS: readonly [
    RoleKey,
    readonly (typeof NAVIGATION_LABELS)[number][],
  ][] = [
    ['owner', [...NAVIGATION_LABELS]],
    ['admin', [...NAVIGATION_LABELS]],
    [
      'supervisor',
      ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Staff Management', 'Help Center'],
    ],
    [
      'hr',
      ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Staff Management', 'Help Center'],
    ],
    ['clinicalDirector', ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Help Center']],
    ['finance', ['Dashboard', 'Courses', 'Billing', 'Help Center']],
    [STUDENT_COLUMN_ROLE, ['Dashboard', 'Courses', 'Help Center']],
  ];

  describe.each(ROLE_MODULE_EXPECTATIONS)('%s', (roleKey, expectedVisible) => {
    it.each(NAVIGATION_LABELS)('%s visibility matches the expected access matrix', (label) => {
      const expected = (expectedVisible as readonly string[]).includes(label);
      expect(rowByLabel(label).check(roleKey), `${roleKey}: ${label}`).toBe(expected);
    });
  });
});

describe('canAccessModule', () => {
  it('resolves a NAVIGATION row by label against the registry', () => {
    expect(canAccessModule('owner', 'Billing')).toBe(true);
    // SUSPECTED BUG (left failing, see the 'supervisor' describe block above):
    // `readEverything` grants billing.read to every read-only role, so this
    // currently evaluates true despite the ruling's "no billing" for supervisor.
    expect(canAccessModule('supervisor', 'Billing')).toBe(false);
    expect(canAccessModule(STUDENT_COLUMN_ROLE, 'Dashboard')).toBe(true);
    expect(canAccessModule(STUDENT_COLUMN_ROLE, 'Status Tracker')).toBe(false);
  });

  it('denies unknown labels (least privilege)', () => {
    expect(canAccessModule('owner', 'Nonexistent Module')).toBe(false);
  });

  it('does not match ACTIONS & DATA rows (NAVIGATION section only)', () => {
    expect(canAccessModule('owner', 'Manage staff roster')).toBe(false);
  });
});
