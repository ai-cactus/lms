/**
 * Unit tests for src/lib/rbac/permissions.ts — the can() checker.
 *
 * Key invariants validated:
 *   - supervisor has everything EXCEPT billing.*
 *   - owner has everything INCLUDING billing.*
 *   - facility.create/edit/delete held only by owner + supervisor; facility.read
 *     is readable by every role (everyone can view their facility)
 *   - finance has billing.* and facility.read but not facility.create/edit/delete
 *   - hr has invite.create + facility.read but not facility.edit or billing.*
 *   - every worker-category role shares one identical permission ceiling:
 *     course.read, enrollment.read/edit, assessment.create/read,
 *     certificate.read, organization.read, facility.read,
 *     notification.read/edit/delete — nothing else
 *   - every role object carries a valid `category` ('manager' | 'worker')
 *     matching its actual scope
 */
import { describe, it, expect } from 'vitest';
import { can, getRoles, permissions, RESOURCES, roles, type RoleKey } from './permissions';

const MANAGER_ROLE_KEYS = ['owner', 'supervisor', 'hr', 'clinicalDirector', 'finance'] as const;

const WORKER_ROLE_KEYS = [
  'psychiatristPrescriber',
  'nurse',
  'therapistClinician',
  'caseManager',
  'behavioralHealthTechnician',
  'peerSupportSpecialist',
  'frontDeskAdmin',
  'facilitiesSupport',
] as const;

const WORKER_PERMISSION_CEILING = [
  'course.read',
  'enrollment.read',
  'enrollment.edit',
  'assessment.create',
  'assessment.read',
  'certificate.read',
  'organization.read',
  'facility.read',
  'notification.read',
  'notification.edit',
  'notification.delete',
] as const;

describe('can() — supervisor (everything except billing)', () => {
  it('supervisor is denied billing.read', () => {
    expect(can('supervisor', 'billing.read')).toBe(false);
  });
  it('supervisor is denied billing.create', () => {
    expect(can('supervisor', 'billing.create')).toBe(false);
  });
  it('supervisor is denied billing.edit', () => {
    expect(can('supervisor', 'billing.edit')).toBe(false);
  });
  it('supervisor is denied billing.delete', () => {
    expect(can('supervisor', 'billing.delete')).toBe(false);
  });
  it('supervisor has facility.edit', () => {
    expect(can('supervisor', 'facility.edit')).toBe(true);
  });
  it('supervisor has facility.read', () => {
    expect(can('supervisor', 'facility.read')).toBe(true);
  });
  it('supervisor has organization.read', () => {
    expect(can('supervisor', 'organization.read')).toBe(true);
  });
  it('supervisor has user.create', () => {
    expect(can('supervisor', 'user.create')).toBe(true);
  });
  it('supervisor has course.delete', () => {
    expect(can('supervisor', 'course.delete')).toBe(true);
  });
  it('supervisor has every permission EXCEPT billing.* (regression guard)', () => {
    for (const permission of permissions) {
      const expected = !permission.startsWith('billing.');
      expect(can('supervisor', permission), `supervisor: ${permission}`).toBe(expected);
    }
  });
});

describe('can() — owner (everything including billing)', () => {
  it('owner has billing.read', () => {
    expect(can('owner', 'billing.read')).toBe(true);
  });
  it('owner has billing.edit', () => {
    expect(can('owner', 'billing.edit')).toBe(true);
  });
  it('owner has facility.edit', () => {
    expect(can('owner', 'facility.edit')).toBe(true);
  });
  it('owner has facility.read', () => {
    expect(can('owner', 'facility.read')).toBe(true);
  });
  it('owner has every permission for every resource', () => {
    const actions = ['create', 'read', 'edit', 'delete'] as const;
    for (const resource of RESOURCES) {
      for (const action of actions) {
        expect(
          can('owner', `${resource}.${action}`),
          `owner should have ${resource}.${action}`,
        ).toBe(true);
      }
    }
  });
});

describe('can() — hr (regression guard: exact permission set)', () => {
  const HR_PERMISSIONS = [
    'user.create',
    'user.read',
    'user.edit',
    'user.delete',
    'invite.create',
    'invite.read',
    'invite.edit',
    'invite.delete',
    'enrollment.create',
    'enrollment.read',
    'enrollment.edit',
    'assignment.create',
    'assignment.read',
    'assignment.edit',
    'assignment.delete',
    'course.read',
    'certificate.read',
    'category.read',
    'document.read',
    'organization.read',
    'facility.read',
    'auditPack.create',
    'auditPack.read',
    'notification.create',
    'notification.read',
    'notification.edit',
    'notification.delete',
  ] as const;

  it('hr has facility.read', () => {
    expect(can('hr', 'facility.read')).toBe(true);
  });
  it('hr is denied facility.edit', () => {
    expect(can('hr', 'facility.edit')).toBe(false);
  });
  it('hr is denied billing.read', () => {
    expect(can('hr', 'billing.read')).toBe(false);
  });
  it('hr has invite.create', () => {
    expect(can('hr', 'invite.create')).toBe(true);
  });
  it('hr has user.read', () => {
    expect(can('hr', 'user.read')).toBe(true);
  });
  it('hr has enrollment.create', () => {
    expect(can('hr', 'enrollment.create')).toBe(true);
  });
  it('hr has exactly the expected permission set — nothing more, nothing less', () => {
    for (const permission of permissions) {
      const expected = (HR_PERMISSIONS as readonly string[]).includes(permission);
      expect(can('hr', permission), `hr: ${permission}`).toBe(expected);
    }
  });
});

describe('can() — finance (regression guard: exact permission set)', () => {
  const FINANCE_PERMISSIONS = [
    'billing.create',
    'billing.read',
    'billing.edit',
    'billing.delete',
    'organization.read',
    'facility.read',
    'user.read',
    'course.read',
    'enrollment.read',
    'certificate.read',
    'auditPack.read',
    'notification.create',
    'notification.read',
    'notification.edit',
    'notification.delete',
  ] as const;

  it('finance has billing.read', () => {
    expect(can('finance', 'billing.read')).toBe(true);
  });
  it('finance has billing.create', () => {
    expect(can('finance', 'billing.create')).toBe(true);
  });
  it('finance is denied facility.edit', () => {
    expect(can('finance', 'facility.edit')).toBe(false);
  });
  it('finance has facility.read', () => {
    expect(can('finance', 'facility.read')).toBe(true);
  });
  it('finance is denied invite.create', () => {
    expect(can('finance', 'invite.create')).toBe(false);
  });
  it('finance is denied user.create', () => {
    expect(can('finance', 'user.create')).toBe(false);
  });
  it('finance has exactly the expected permission set — nothing more, nothing less', () => {
    for (const permission of permissions) {
      const expected = (FINANCE_PERMISSIONS as readonly string[]).includes(permission);
      expect(can('finance', permission), `finance: ${permission}`).toBe(expected);
    }
  });
});

describe('can() — clinicalDirector (regression guard: exact permission set)', () => {
  const CLINICAL_DIRECTOR_PERMISSIONS = [
    'course.create',
    'course.read',
    'course.edit',
    'course.delete',
    'assessment.create',
    'assessment.read',
    'assessment.edit',
    'assessment.delete',
    'enrollment.create',
    'enrollment.read',
    'enrollment.edit',
    'assignment.create',
    'assignment.read',
    'assignment.edit',
    'assignment.delete',
    'category.create',
    'category.read',
    'category.edit',
    'category.delete',
    'document.create',
    'document.read',
    'document.edit',
    'document.delete',
    'standardManual.read',
    'certificate.read',
    'user.read',
    'organization.read',
    'facility.read',
    'auditPack.create',
    'auditPack.read',
    'notification.create',
    'notification.read',
    'notification.edit',
    'notification.delete',
  ] as const;

  it('clinicalDirector has course.create', () => {
    expect(can('clinicalDirector', 'course.create')).toBe(true);
  });
  it('clinicalDirector has assessment.read', () => {
    expect(can('clinicalDirector', 'assessment.read')).toBe(true);
  });
  it('clinicalDirector is denied billing.read', () => {
    expect(can('clinicalDirector', 'billing.read')).toBe(false);
  });
  it('clinicalDirector has facility.read', () => {
    expect(can('clinicalDirector', 'facility.read')).toBe(true);
  });
  it('clinicalDirector is denied invite.create', () => {
    expect(can('clinicalDirector', 'invite.create')).toBe(false);
  });
  it('clinicalDirector has exactly the expected permission set — nothing more, nothing less', () => {
    for (const permission of permissions) {
      const expected = (CLINICAL_DIRECTOR_PERMISSIONS as readonly string[]).includes(permission);
      expect(can('clinicalDirector', permission), `clinicalDirector: ${permission}`).toBe(expected);
    }
  });
});

describe('can() — every worker-category role shares the identical permission ceiling', () => {
  it.each(WORKER_ROLE_KEYS)('%s is denied billing.read', (role) => {
    expect(can(role, 'billing.read')).toBe(false);
  });
  it.each(WORKER_ROLE_KEYS)('%s has facility.read', (role) => {
    expect(can(role, 'facility.read')).toBe(true);
  });
  it.each(WORKER_ROLE_KEYS)('%s has organization.read', (role) => {
    expect(can(role, 'organization.read')).toBe(true);
  });
  it.each(WORKER_ROLE_KEYS)('%s is denied facility.edit', (role) => {
    expect(can(role, 'facility.edit')).toBe(false);
  });
  it.each(WORKER_ROLE_KEYS)('%s is denied invite.create', (role) => {
    expect(can(role, 'invite.create')).toBe(false);
  });
  it.each(WORKER_ROLE_KEYS)('%s is denied user.create', (role) => {
    expect(can(role, 'user.create')).toBe(false);
  });
  it.each(WORKER_ROLE_KEYS)('%s has course.read', (role) => {
    expect(can(role, 'course.read')).toBe(true);
  });
  it.each(WORKER_ROLE_KEYS)('%s has enrollment.read', (role) => {
    expect(can(role, 'enrollment.read')).toBe(true);
  });
  it.each(WORKER_ROLE_KEYS)('%s has certificate.read', (role) => {
    expect(can(role, 'certificate.read')).toBe(true);
  });

  it.each(WORKER_ROLE_KEYS)(
    '%s resolves to EXACTLY the worker permission ceiling — nothing more, nothing less',
    (role) => {
      for (const permission of permissions) {
        const expected = (WORKER_PERMISSION_CEILING as readonly string[]).includes(permission);
        expect(can(role, permission), `${role}: ${permission}`).toBe(expected);
      }
    },
  );

  it('all 8 worker roles resolve to the exact same permission set (identical ceiling)', () => {
    const sets = WORKER_ROLE_KEYS.map((role) => [...roles[role].permissions].sort().join(','));
    const [first, ...rest] = sets;
    for (const set of rest) {
      expect(set).toBe(first);
    }
  });
});

describe('organization.read + facility.read — granted to every one of the 13 roles', () => {
  // Regression guard for the change that gave hr/clinicalDirector/finance
  // facility.read and gave workerPermissions organization.read + facility.read:
  // every role, manager or worker, must hold both.
  it.each([...MANAGER_ROLE_KEYS, ...WORKER_ROLE_KEYS])('%s has organization.read', (role) => {
    expect(can(role, 'organization.read')).toBe(true);
  });
  it.each([...MANAGER_ROLE_KEYS, ...WORKER_ROLE_KEYS])('%s has facility.read', (role) => {
    expect(can(role, 'facility.read')).toBe(true);
  });
});

describe('facility.* permissions — full CRUD is owner/supervisor-only; read is universal', () => {
  const facilityActions = ['create', 'read', 'edit', 'delete'] as const;
  const facilityWriteActions = ['create', 'edit', 'delete'] as const;
  const rolesWithFacility = ['owner', 'supervisor'] as const;
  // Every non-owner/supervisor role can read its facility but never mutate it.
  const rolesWithReadOnlyFacility = [
    'hr',
    'clinicalDirector',
    'finance',
    ...WORKER_ROLE_KEYS,
  ] as const;

  it.each(rolesWithFacility)('%s has all facility.* permissions', (role) => {
    for (const action of facilityActions) {
      expect(can(role, `facility.${action}`), `${role} should have facility.${action}`).toBe(true);
    }
  });

  it.each(rolesWithReadOnlyFacility)(
    '%s has facility.read but no facility write actions',
    (role) => {
      expect(can(role, 'facility.read'), `${role} should have facility.read`).toBe(true);
      for (const action of facilityWriteActions) {
        expect(can(role, `facility.${action}`), `${role} should NOT have facility.${action}`).toBe(
          false,
        );
      }
    },
  );
});

describe('can() — regression: unknown/stale role keys deny instead of throwing', () => {
  it('returns false (does not throw) for an undefined role', () => {
    expect(() => can(undefined, 'course.read')).not.toThrow();
    expect(can(undefined, 'course.read')).toBe(false);
  });

  it('returns false (does not throw) for a bogus role key not in the registry', () => {
    expect(() => can('nope' as RoleKey, 'course.read')).not.toThrow();
    expect(can('nope' as RoleKey, 'course.read')).toBe(false);
  });

  it('returns false (does not throw) for the retired "worker" role key', () => {
    expect(() => can('worker' as RoleKey, 'course.read')).not.toThrow();
    expect(can('worker' as RoleKey, 'course.read')).toBe(false);
  });
});

describe('Role.category — every role carries a valid, correctly-scoped category', () => {
  it('every role in the registry has category "manager" or "worker"', () => {
    for (const role of getRoles()) {
      expect(['manager', 'worker']).toContain(role.category);
    }
  });

  it.each(MANAGER_ROLE_KEYS)('%s has category "manager"', (roleKey: RoleKey) => {
    expect(roles[roleKey].category).toBe('manager');
  });

  it.each(WORKER_ROLE_KEYS)('%s has category "worker"', (roleKey: RoleKey) => {
    expect(roles[roleKey].category).toBe('worker');
  });

  it('has exactly 13 roles total (5 manager + 8 worker)', () => {
    expect(getRoles()).toHaveLength(13);
    expect(getRoles().filter((r) => r.category === 'manager')).toHaveLength(5);
    expect(getRoles().filter((r) => r.category === 'worker')).toHaveLength(8);
  });
});
