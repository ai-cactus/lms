/**
 * Registry pinning for the D-01 cluster.
 *
 * D-01 was a Critical read-authorization defect: Finance and Clinical Director
 * reached the full staff directory and organisation-wide audit exports while
 * holding none of the permissions that should have allowed it, and Facility
 * Supervisor read every facility instead of their own.
 *
 * These assertions are deliberately exhaustive rather than spot checks. A
 * registry edit that re-grants `user.read` to Finance — or quietly adds
 * `supervisor` to ORG_WIDE_FACILITY_ROLES — must fail here and force a
 * deliberate test edit, not sail through because nobody thought to look.
 *
 * This is the test that would have caught D-01.
 */
import { describe, expect, it } from 'vitest';
import { roles, can, type RoleKey } from './permissions';
import { isOrgWideFacilityRole } from '@/lib/facility/scope';
import type { Role } from '@/types/next-auth';

const ALL_ROLE_KEYS = Object.keys(roles) as RoleKey[];

/** Roles allowed to read the staff roster. Everyone else must be denied. */
const USER_READ_HOLDERS: RoleKey[] = ['owner', 'admin', 'supervisor', 'hr'];

/** Roles allowed to GENERATE an auditor pack (bulk PHI/PII egress). */
const AUDIT_PACK_CREATE_HOLDERS: RoleKey[] = ['owner', 'admin', 'hr', 'clinicalDirector'];

/** Roles allowed to VIEW audit surfaces. Supervisor reads but cannot generate. */
const AUDIT_PACK_READ_HOLDERS: RoleKey[] = [
  'owner',
  'admin',
  'hr',
  'clinicalDirector',
  'supervisor',
];

describe('D-01 registry partition', () => {
  describe('user.read — the staff roster', () => {
    it.each(USER_READ_HOLDERS)('%s holds user.read', (role) => {
      expect(can(role, 'user.read')).toBe(true);
    });

    it.each(ALL_ROLE_KEYS.filter((r) => !USER_READ_HOLDERS.includes(r)))(
      '%s is DENIED user.read',
      (role) => {
        expect(can(role, 'user.read')).toBe(false);
      },
    );

    it('denies finance and clinicalDirector specifically — the D-01 roles', () => {
      expect(can('finance', 'user.read')).toBe(false);
      expect(can('clinicalDirector', 'user.read')).toBe(false);
    });
  });

  describe('auditPack — export generation vs viewing', () => {
    it.each(AUDIT_PACK_CREATE_HOLDERS)('%s holds auditPack.create', (role) => {
      expect(can(role, 'auditPack.create')).toBe(true);
    });

    it.each(ALL_ROLE_KEYS.filter((r) => !AUDIT_PACK_CREATE_HOLDERS.includes(r)))(
      '%s is DENIED auditPack.create',
      (role) => {
        expect(can(role, 'auditPack.create')).toBe(false);
      },
    );

    it.each(AUDIT_PACK_READ_HOLDERS)('%s holds auditPack.read', (role) => {
      expect(can(role, 'auditPack.read')).toBe(true);
    });

    it('supervisor may READ audit surfaces but not GENERATE an export', () => {
      expect(can('supervisor', 'auditPack.read')).toBe(true);
      expect(can('supervisor', 'auditPack.create')).toBe(false);
    });

    it('finance holds no auditPack permission at all', () => {
      expect(can('finance', 'auditPack.read')).toBe(false);
      expect(can('finance', 'auditPack.create')).toBe(false);
      expect(can('finance', 'audit.read')).toBe(false);
    });
  });

  describe('facility scope — who aggregates across the whole organisation', () => {
    const ORG_WIDE: Role[] = ['owner', 'admin', 'hr', 'clinical_director', 'finance'];

    it.each(ORG_WIDE)('%s is org-wide', (role) => {
      expect(isOrgWideFacilityRole(role)).toBe(true);
    });

    it('supervisor is NOT org-wide — facility-bound by scope, not by verb', () => {
      expect(isOrgWideFacilityRole('supervisor')).toBe(false);
    });

    it('hr IS org-wide by design and must not be swept into the supervisor fix (TC-HR-001)', () => {
      expect(isOrgWideFacilityRole('hr')).toBe(true);
    });

    it('every worker role is facility-bound', () => {
      for (const role of ['nurse', 'therapist_clinician', 'front_desk_admin'] as Role[]) {
        expect(isOrgWideFacilityRole(role)).toBe(false);
      }
    });
  });
});
