/**
 * Unit tests for src/lib/rbac/role-utils.ts
 *
 * Verifies the core RBAC utilities: DB-enum ↔ RoleKey conversion, role sets,
 * grant matrix, and convenience predicates.  No external dependencies — all
 * pure functions, no mocking required.
 */
import { describe, it, expect } from 'vitest';
import {
  dbRoleToRoleKey,
  getRoleDisplayName,
  ADMIN_ROLES,
  WORKER_ROLES,
  ALL_ROLES,
  GRANTABLE_ROLES,
  isAdminRole,
  isWorkerRole,
} from './role-utils';

describe('dbRoleToRoleKey', () => {
  it('maps supervisor → supervisor (identity — was super_admin in delta v2)', () => {
    expect(dbRoleToRoleKey('supervisor')).toBe('supervisor');
  });

  it('maps clinical_director → clinicalDirector (only non-identity mapping)', () => {
    expect(dbRoleToRoleKey('clinical_director')).toBe('clinicalDirector');
  });

  it('maps owner → owner (identity)', () => {
    expect(dbRoleToRoleKey('owner')).toBe('owner');
  });

  it('maps hr → hr (identity)', () => {
    expect(dbRoleToRoleKey('hr')).toBe('hr');
  });

  it('maps finance → finance (identity)', () => {
    expect(dbRoleToRoleKey('finance')).toBe('finance');
  });

  it('maps worker → worker (identity)', () => {
    expect(dbRoleToRoleKey('worker')).toBe('worker');
  });
});

describe('getRoleDisplayName', () => {
  it('returns a non-empty string for supervisor', () => {
    expect(getRoleDisplayName('supervisor')).toContain('Supervisor');
  });

  it('returns a non-empty string for clinical_director', () => {
    expect(getRoleDisplayName('clinical_director')).toContain('Clinical Director');
  });

  it('returns a non-empty string for all six roles', () => {
    const roles = ['owner', 'supervisor', 'hr', 'clinical_director', 'finance', 'worker'] as const;
    for (const r of roles) {
      const name = getRoleDisplayName(r);
      expect(name.length, `Display name for ${r} should be non-empty`).toBeGreaterThan(0);
    }
  });
});

describe('ADMIN_ROLES', () => {
  it('contains exactly the five non-worker roles', () => {
    expect([...ADMIN_ROLES].sort()).toEqual(
      ['clinical_director', 'finance', 'hr', 'owner', 'supervisor'].sort(),
    );
  });

  it('does not contain worker', () => {
    expect(ADMIN_ROLES).not.toContain('worker');
  });
});

describe('WORKER_ROLES', () => {
  it('contains only worker', () => {
    expect(WORKER_ROLES).toEqual(['worker']);
  });
});

describe('ALL_ROLES', () => {
  it('contains all six roles', () => {
    expect(ALL_ROLES).toHaveLength(6);
  });

  it('is the union of ADMIN_ROLES and WORKER_ROLES', () => {
    const expected = new Set([...ADMIN_ROLES, ...WORKER_ROLES]);
    expect(new Set(ALL_ROLES)).toEqual(expected);
  });
});

describe('GRANTABLE_ROLES — owner is never grantable', () => {
  it('owner does not appear in any grantable list (established only at org creation)', () => {
    for (const inviterRole of ALL_ROLES) {
      expect(GRANTABLE_ROLES[inviterRole]).not.toContain('owner');
    }
  });
});

describe('GRANTABLE_ROLES — owner can grant all non-owner roles', () => {
  it('owner can grant supervisor', () => expect(GRANTABLE_ROLES['owner']).toContain('supervisor'));
  it('owner can grant hr', () => expect(GRANTABLE_ROLES['owner']).toContain('hr'));
  it('owner can grant clinical_director', () =>
    expect(GRANTABLE_ROLES['owner']).toContain('clinical_director'));
  it('owner can grant finance', () => expect(GRANTABLE_ROLES['owner']).toContain('finance'));
  it('owner can grant worker', () => expect(GRANTABLE_ROLES['owner']).toContain('worker'));
});

describe('GRANTABLE_ROLES — supervisor mirrors owner grantable set', () => {
  it('supervisor grantable set equals owner grantable set', () => {
    expect([...GRANTABLE_ROLES['supervisor']].sort()).toEqual([...GRANTABLE_ROLES['owner']].sort());
  });
});

describe('GRANTABLE_ROLES — HR grant matrix (D1)', () => {
  it('hr can grant hr', () => expect(GRANTABLE_ROLES['hr']).toContain('hr'));
  it('hr can grant clinical_director', () =>
    expect(GRANTABLE_ROLES['hr']).toContain('clinical_director'));
  it('hr can grant finance', () => expect(GRANTABLE_ROLES['hr']).toContain('finance'));
  it('hr can grant worker', () => expect(GRANTABLE_ROLES['hr']).toContain('worker'));
  it('hr CANNOT grant supervisor (D1)', () =>
    expect(GRANTABLE_ROLES['hr']).not.toContain('supervisor'));
  it('hr CANNOT grant owner', () => expect(GRANTABLE_ROLES['hr']).not.toContain('owner'));
});

describe('GRANTABLE_ROLES — no-grant roles have empty arrays', () => {
  it('clinical_director cannot grant any role', () => {
    expect(GRANTABLE_ROLES['clinical_director']).toHaveLength(0);
  });
  it('finance cannot grant any role', () => {
    expect(GRANTABLE_ROLES['finance']).toHaveLength(0);
  });
  it('worker cannot grant any role', () => {
    expect(GRANTABLE_ROLES['worker']).toHaveLength(0);
  });
});

describe('isAdminRole', () => {
  it('returns true for owner', () => expect(isAdminRole('owner')).toBe(true));
  it('returns true for supervisor', () => expect(isAdminRole('supervisor')).toBe(true));
  it('returns true for hr', () => expect(isAdminRole('hr')).toBe(true));
  it('returns true for clinical_director', () =>
    expect(isAdminRole('clinical_director')).toBe(true));
  it('returns true for finance', () => expect(isAdminRole('finance')).toBe(true));
  it('returns false for worker', () => expect(isAdminRole('worker')).toBe(false));
  it('returns false for null', () => expect(isAdminRole(null)).toBe(false));
  it('returns false for undefined', () => expect(isAdminRole(undefined)).toBe(false));
  it('returns false for empty string', () => expect(isAdminRole('')).toBe(false));
  it('returns false for the retired admin role string', () =>
    expect(isAdminRole('admin')).toBe(false));
});

describe('isWorkerRole', () => {
  it('returns true for worker', () => expect(isWorkerRole('worker')).toBe(true));
  it('returns false for supervisor', () => expect(isWorkerRole('supervisor')).toBe(false));
  it('returns false for owner', () => expect(isWorkerRole('owner')).toBe(false));
  it('returns false for null', () => expect(isWorkerRole(null)).toBe(false));
});
