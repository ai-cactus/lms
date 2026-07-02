/**
 * Unit tests for src/lib/rbac/permissions.ts — the can() checker.
 *
 * Key invariants validated:
 *   - supervisor has everything EXCEPT billing.*
 *   - owner has everything INCLUDING billing.*
 *   - facility.* held only by owner + supervisor
 *   - finance has billing.* but not facility.*
 *   - hr has invite.create but not facility.* or billing.*
 *   - worker has course.read, enrollment.*, assessment.*, certificate.read — nothing else
 */
import { describe, it, expect } from 'vitest';
import { can, RESOURCES } from './permissions';

// ── Supervisor ────────────────────────────────────────────────────────────────

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
});

// ── Owner ─────────────────────────────────────────────────────────────────────

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

// ── HR ────────────────────────────────────────────────────────────────────────

describe('can() — hr', () => {
  it('hr is denied facility.read', () => {
    expect(can('hr', 'facility.read')).toBe(false);
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
});

// ── Finance ───────────────────────────────────────────────────────────────────

describe('can() — finance', () => {
  it('finance has billing.read', () => {
    expect(can('finance', 'billing.read')).toBe(true);
  });
  it('finance has billing.create', () => {
    expect(can('finance', 'billing.create')).toBe(true);
  });
  it('finance is denied facility.edit', () => {
    expect(can('finance', 'facility.edit')).toBe(false);
  });
  it('finance is denied facility.read', () => {
    expect(can('finance', 'facility.read')).toBe(false);
  });
  it('finance is denied invite.create', () => {
    expect(can('finance', 'invite.create')).toBe(false);
  });
  it('finance is denied user.create', () => {
    expect(can('finance', 'user.create')).toBe(false);
  });
});

// ── Clinical Director ─────────────────────────────────────────────────────────

describe('can() — clinicalDirector', () => {
  it('clinicalDirector has course.create', () => {
    expect(can('clinicalDirector', 'course.create')).toBe(true);
  });
  it('clinicalDirector has assessment.read', () => {
    expect(can('clinicalDirector', 'assessment.read')).toBe(true);
  });
  it('clinicalDirector is denied billing.read', () => {
    expect(can('clinicalDirector', 'billing.read')).toBe(false);
  });
  it('clinicalDirector is denied facility.read', () => {
    expect(can('clinicalDirector', 'facility.read')).toBe(false);
  });
  it('clinicalDirector is denied invite.create', () => {
    expect(can('clinicalDirector', 'invite.create')).toBe(false);
  });
});

// ── Worker ────────────────────────────────────────────────────────────────────

describe('can() — worker', () => {
  it('worker is denied billing.read', () => {
    expect(can('worker', 'billing.read')).toBe(false);
  });
  it('worker is denied facility.read', () => {
    expect(can('worker', 'facility.read')).toBe(false);
  });
  it('worker is denied invite.create', () => {
    expect(can('worker', 'invite.create')).toBe(false);
  });
  it('worker is denied user.create', () => {
    expect(can('worker', 'user.create')).toBe(false);
  });
  it('worker has course.read', () => {
    expect(can('worker', 'course.read')).toBe(true);
  });
  it('worker has enrollment.read', () => {
    expect(can('worker', 'enrollment.read')).toBe(true);
  });
  it('worker has certificate.read', () => {
    expect(can('worker', 'certificate.read')).toBe(true);
  });
});

// ── Facility permission ownership ─────────────────────────────────────────────

describe('facility.* permissions are held only by owner and supervisor', () => {
  const facilityActions = ['create', 'read', 'edit', 'delete'] as const;
  const rolesWithFacility = ['owner', 'supervisor'] as const;
  const rolesWithoutFacility = ['hr', 'clinicalDirector', 'finance', 'worker'] as const;

  it.each(rolesWithFacility)('%s has all facility.* permissions', (role) => {
    for (const action of facilityActions) {
      expect(can(role, `facility.${action}`), `${role} should have facility.${action}`).toBe(true);
    }
  });

  it.each(rolesWithoutFacility)('%s has NO facility.* permissions', (role) => {
    for (const action of facilityActions) {
      expect(can(role, `facility.${action}`), `${role} should NOT have facility.${action}`).toBe(
        false,
      );
    }
  });
});
