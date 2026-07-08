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
  DEFAULT_SELF_SERVE_WORKER_ROLE,
  isAdminRole,
  isWorkerRole,
} from './role-utils';
import type { Role } from '@/types/next-auth';

const WORKER_DB_ROLES = [
  'psychiatrist_prescriber',
  'nurse',
  'therapist_clinician',
  'case_manager',
  'behavioral_health_technician',
  'peer_support_specialist',
  'front_desk_admin',
  'facilities_support',
] as const;

describe('dbRoleToRoleKey', () => {
  it('maps supervisor → supervisor (identity — was super_admin in delta v2)', () => {
    expect(dbRoleToRoleKey('supervisor')).toBe('supervisor');
  });

  it('maps clinical_director → clinicalDirector (only non-identity mapping among managers)', () => {
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

  it('maps psychiatrist_prescriber → psychiatristPrescriber (camelCase)', () => {
    expect(dbRoleToRoleKey('psychiatrist_prescriber')).toBe('psychiatristPrescriber');
  });

  it('maps nurse → nurse (identity)', () => {
    expect(dbRoleToRoleKey('nurse')).toBe('nurse');
  });

  it('maps therapist_clinician → therapistClinician (camelCase)', () => {
    expect(dbRoleToRoleKey('therapist_clinician')).toBe('therapistClinician');
  });

  it('maps case_manager → caseManager (camelCase)', () => {
    expect(dbRoleToRoleKey('case_manager')).toBe('caseManager');
  });

  it('maps behavioral_health_technician → behavioralHealthTechnician (camelCase)', () => {
    expect(dbRoleToRoleKey('behavioral_health_technician')).toBe('behavioralHealthTechnician');
  });

  it('maps peer_support_specialist → peerSupportSpecialist (camelCase)', () => {
    expect(dbRoleToRoleKey('peer_support_specialist')).toBe('peerSupportSpecialist');
  });

  it('maps front_desk_admin → frontDeskAdmin (camelCase)', () => {
    expect(dbRoleToRoleKey('front_desk_admin')).toBe('frontDeskAdmin');
  });

  it('maps facilities_support → facilitiesSupport (camelCase)', () => {
    expect(dbRoleToRoleKey('facilities_support')).toBe('facilitiesSupport');
  });
});

describe('dbRoleToRoleKey — regression: retired/unknown DB role denies instead of throwing', () => {
  it('returns undefined (does not throw) for the retired "worker" role', () => {
    expect(() => dbRoleToRoleKey('worker' as Role)).not.toThrow();
    expect(dbRoleToRoleKey('worker' as Role)).toBeUndefined();
  });

  it('returns undefined for a wholly bogus role string', () => {
    expect(dbRoleToRoleKey('nope' as Role)).toBeUndefined();
  });

  it.each(ALL_ROLES)('returns a defined RoleKey for the valid role %s', (role) => {
    expect(dbRoleToRoleKey(role)).toBeDefined();
  });
});

describe('getRoleDisplayName', () => {
  it('returns a non-empty string for supervisor', () => {
    expect(getRoleDisplayName('supervisor')).toContain('Supervisor');
  });

  it('returns a non-empty string for clinical_director', () => {
    expect(getRoleDisplayName('clinical_director')).toContain('Clinical Director');
  });

  it('returns a non-empty string for all 13 roles', () => {
    for (const r of ALL_ROLES) {
      const name = getRoleDisplayName(r);
      expect(name.length, `Display name for ${r} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('regression: falls back to the raw role string (does not throw) for the retired "worker" role', () => {
    expect(() => getRoleDisplayName('worker' as Role)).not.toThrow();
    expect(getRoleDisplayName('worker' as Role)).toBe('worker');
  });

  it('regression: falls back to the raw role string for a wholly bogus role', () => {
    expect(getRoleDisplayName('nope' as Role)).toBe('nope');
  });
});

describe('ADMIN_ROLES', () => {
  it('contains exactly the five manager (non-worker) roles', () => {
    expect([...ADMIN_ROLES].sort()).toEqual(
      ['clinical_director', 'finance', 'hr', 'owner', 'supervisor'].sort(),
    );
  });

  it('does not contain any worker role', () => {
    for (const workerRole of WORKER_DB_ROLES) {
      expect(ADMIN_ROLES).not.toContain(workerRole);
    }
  });
});

describe('WORKER_ROLES', () => {
  it('contains exactly the 8 job-specific worker roles', () => {
    expect([...WORKER_ROLES].sort()).toEqual([...WORKER_DB_ROLES].sort());
  });

  it('has length 8', () => {
    expect(WORKER_ROLES).toHaveLength(8);
  });
});

describe('DEFAULT_SELF_SERVE_WORKER_ROLE', () => {
  it('is a member of WORKER_ROLES', () => {
    expect(WORKER_ROLES).toContain(DEFAULT_SELF_SERVE_WORKER_ROLE);
  });

  it('is front_desk_admin', () => {
    expect(DEFAULT_SELF_SERVE_WORKER_ROLE).toBe('front_desk_admin');
  });
});

describe('ALL_ROLES', () => {
  it('contains all 13 roles', () => {
    expect(ALL_ROLES).toHaveLength(13);
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
  it.each(WORKER_DB_ROLES)('owner can grant worker role %s', (workerRole) => {
    expect(GRANTABLE_ROLES['owner']).toContain(workerRole);
  });
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
  it.each(WORKER_DB_ROLES)('hr can grant worker role %s', (workerRole) => {
    expect(GRANTABLE_ROLES['hr']).toContain(workerRole);
  });
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
  it.each(WORKER_DB_ROLES)('worker role %s cannot grant any role', (workerRole) => {
    expect(GRANTABLE_ROLES[workerRole]).toHaveLength(0);
  });
});

describe('isAdminRole', () => {
  it('returns true for owner', () => expect(isAdminRole('owner')).toBe(true));
  it('returns true for supervisor', () => expect(isAdminRole('supervisor')).toBe(true));
  it('returns true for hr', () => expect(isAdminRole('hr')).toBe(true));
  it('returns true for clinical_director', () =>
    expect(isAdminRole('clinical_director')).toBe(true));
  it('returns true for finance', () => expect(isAdminRole('finance')).toBe(true));
  it.each(WORKER_DB_ROLES)('returns false for worker role %s', (workerRole) => {
    expect(isAdminRole(workerRole)).toBe(false);
  });
  it('returns false for null', () => expect(isAdminRole(null)).toBe(false));
  it('returns false for undefined', () => expect(isAdminRole(undefined)).toBe(false));
  it('returns false for empty string', () => expect(isAdminRole('')).toBe(false));
  it('returns false for the retired worker role string', () =>
    expect(isAdminRole('worker')).toBe(false));
  it('returns false for the retired admin role string', () =>
    expect(isAdminRole('admin')).toBe(false));
});

describe('isWorkerRole', () => {
  it.each(WORKER_DB_ROLES)('returns true for worker role %s', (workerRole) => {
    expect(isWorkerRole(workerRole)).toBe(true);
  });
  it('returns false for supervisor', () => expect(isWorkerRole('supervisor')).toBe(false));
  it('returns false for owner', () => expect(isWorkerRole('owner')).toBe(false));
  it('returns false for the retired worker role string (no longer a real role)', () =>
    expect(isWorkerRole('worker')).toBe(false));
  it('returns false for null', () => expect(isWorkerRole(null)).toBe(false));
});
