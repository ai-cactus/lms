/**
 * Unit tests for the Settings → Roles matrix config.
 *
 * The matrix is derived live from the RBAC registry (`permissions.ts`) via
 * `can()`, so these spot-checks double as a guard that the registry keeps giving
 * the expected shape (owner = everything, finance ≈ billing, workers ≈ nothing,
 * Settings = owner-only).
 */
import { describe, it, expect } from 'vitest';
import { MATRIX_COLUMNS, MATRIX_ROWS, STUDENT_COLUMN_ROLE } from './roles-matrix-config';

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
});

describe('student (representative worker role)', () => {
  it('is denied admin sections and actions', () => {
    expect(rowByLabel('Dashboard').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Staff Management').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Billing').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Manage staff roster').check(STUDENT_COLUMN_ROLE)).toBe(false);
    expect(rowByLabel('Settings').check(STUDENT_COLUMN_ROLE)).toBe(false);
  });

  it('may still read the Courses section (workers hold course.read)', () => {
    expect(rowByLabel('Courses').check(STUDENT_COLUMN_ROLE)).toBe(true);
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
