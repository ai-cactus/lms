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
  it('exposes the six expected columns in order', () => {
    expect(MATRIX_COLUMNS.map((c) => c.key)).toEqual([
      'owner',
      'supervisor',
      'hr',
      'clinicalDirector',
      'finance',
      STUDENT_COLUMN_ROLE,
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
  it('has full facility access except billing (everythingExceptBilling)', () => {
    expect(rowByLabel('Manage staff roster').check('supervisor')).toBe(true);
    expect(rowByLabel('Invite & change user roles').check('supervisor')).toBe(true);
    expect(rowByLabel('Build & edit courses').check('supervisor')).toBe(true);
    expect(rowByLabel('Billing').check('supervisor')).toBe(false);
    expect(rowByLabel('Manage billing & invoices').check('supervisor')).toBe(false);
    expect(rowByLabel('Settings').check('supervisor')).toBe(false);
  });
});

describe('hr', () => {
  it('manages staff and invites but cannot author courses or reach billing/settings', () => {
    expect(rowByLabel('Manage staff roster').check('hr')).toBe(true);
    expect(rowByLabel('Invite & change user roles').check('hr')).toBe(true);
    expect(rowByLabel('Build & edit courses').check('hr')).toBe(false);
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
  it('is owner-only', () => {
    const settings = rowByLabel('Settings');
    expect(settings.check('owner')).toBe(true);
    for (const column of MATRIX_COLUMNS) {
      if (column.key === 'owner') continue;
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

describe('per-role NAVIGATION module list — exact assertions for all 5 manager roles + worker', () => {
  // Mirrors the authoritative access matrix: owner sees everything; supervisor
  // adds every module except Billing/Settings; hr and clinicalDirector match
  // supervisor minus Staff-roster write access is irrelevant here (NAVIGATION
  // only cares about read visibility, and both hold user.read); finance trades
  // Documents/Status Tracker for Billing; the worker representative only holds
  // the three universally-readable modules.
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
    [
      'supervisor',
      ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Staff Management', 'Help Center'],
    ],
    [
      'hr',
      ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Staff Management', 'Help Center'],
    ],
    [
      'clinicalDirector',
      ['Dashboard', 'Documents', 'Courses', 'Status Tracker', 'Staff Management', 'Help Center'],
    ],
    ['finance', ['Dashboard', 'Courses', 'Staff Management', 'Billing', 'Help Center']],
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
