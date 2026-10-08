import { describe, it, expect } from 'vitest';
import { checkInviteRolePath, invitePathForRole, rolesForInvitePath } from './invite-role-path';
import { GRANTABLE_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';
import type { Role } from '@/types/next-auth';

const ALL_ROLES = Object.keys(GRANTABLE_ROLES) as Role[];

describe('invitePathForRole', () => {
  it.each<Role>(['owner', 'admin', 'hr', 'clinical_director', 'finance'])(
    'puts the org-wide role %s on the global path',
    (role) => {
      expect(invitePathForRole(role)).toBe('global');
    },
  );

  it.each<Role>(['supervisor', ...WORKER_ROLES])(
    'puts the facility-bound role %s on the facility path',
    (role) => {
      expect(invitePathForRole(role)).toBe('facility');
    },
  );

  it('classifies every role exactly one way (no role is left without a path)', () => {
    for (const role of ALL_ROLES) {
      expect(['global', 'facility']).toContain(invitePathForRole(role));
    }
  });
});

describe('rolesForInvitePath', () => {
  it.each<Role>(['owner', 'admin', 'hr'])(
    'splits everything %s may grant into global + facility with nothing lost or duplicated',
    (inviter) => {
      const grantable = GRANTABLE_ROLES[inviter];
      const global = rolesForInvitePath('global', grantable);
      const facility = rolesForInvitePath('facility', grantable);

      expect([...global, ...facility].sort()).toEqual([...grantable].sort());
      expect(global.filter((role) => facility.includes(role))).toEqual([]);
    },
  );

  it('offers an owner admin, hr, clinical_director and finance under Global, in grant order', () => {
    expect(rolesForInvitePath('global', GRANTABLE_ROLES.owner)).toEqual([
      'admin',
      'hr',
      'clinical_director',
      'finance',
    ]);
  });

  it('offers an admin or HR inviter the same Global set minus admin', () => {
    const expected = ['hr', 'clinical_director', 'finance'];
    expect(rolesForInvitePath('global', GRANTABLE_ROLES.admin)).toEqual(expected);
    expect(rolesForInvitePath('global', GRANTABLE_ROLES.hr)).toEqual(expected);
  });

  it('offers a facility invite the supervisor plus every worker role, and no org-wide role', () => {
    for (const inviter of ['owner', 'admin', 'hr'] as const) {
      expect(rolesForInvitePath('facility', GRANTABLE_ROLES[inviter])).toEqual([
        'supervisor',
        ...WORKER_ROLES,
      ]);
    }
  });

  it('never offers owner on either path, for any inviter', () => {
    for (const inviter of ALL_ROLES) {
      for (const path of ['global', 'facility'] as const) {
        expect(rolesForInvitePath(path, GRANTABLE_ROLES[inviter])).not.toContain('owner');
      }
    }
  });

  it('offers finance on the global path only', () => {
    expect(rolesForInvitePath('global', GRANTABLE_ROLES.owner)).toContain('finance');
    expect(rolesForInvitePath('facility', GRANTABLE_ROLES.owner)).not.toContain('finance');
  });

  it('returns nothing for an inviter who can grant nothing', () => {
    expect(rolesForInvitePath('global', GRANTABLE_ROLES.supervisor)).toEqual([]);
    expect(rolesForInvitePath('facility', GRANTABLE_ROLES.supervisor)).toEqual([]);
  });
});

describe('checkInviteRolePath', () => {
  it('accepts a role on its own path', () => {
    expect(checkInviteRolePath('hr', 'global')).toEqual({ ok: true });
    expect(checkInviteRolePath('nurse', 'facility')).toEqual({ ok: true });
    expect(checkInviteRolePath('supervisor', 'facility')).toEqual({ ok: true });
  });

  it('refuses a facility-bound role on Global with the "specific facility" message', () => {
    expect(checkInviteRolePath('nurse', 'global')).toEqual({
      ok: false,
      message: 'Nurse must be invited to a specific facility.',
    });
    expect(checkInviteRolePath('supervisor', 'global')).toEqual({
      ok: false,
      message: 'Facility Supervisor must be invited to a specific facility.',
    });
  });

  it.each([
    ['hr', 'HR'],
    ['finance', 'Finance'],
    ['clinical_director', 'Clinical Director'],
    ['admin', 'Admin'],
  ] as const)('refuses %s on a facility with the "organization-wide" message', (role, name) => {
    expect(checkInviteRolePath(role, 'facility')).toEqual({
      ok: false,
      message: `${name} is organization-wide — invite with Global.`,
    });
  });
});
