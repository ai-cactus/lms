/**
 * Unit tests for src/lib/notifications/link-audience.ts (Q-25): which admin
 * roles may receive a notice, by the page its link opens. Uses the real RBAC
 * registry, so a permission change there shows up here.
 */
import { describe, it, expect } from 'vitest';
import {
  LADDER_ESCALATION_PERMISSION,
  REASSIGN_ESCALATION_PERMISSION,
  permissionForLink,
  roleHolds,
  roleMayOpenLink,
} from './link-audience';
import type { Role } from '@/types/next-auth';

describe('permissionForLink', () => {
  it.each([
    ['/dashboard/staff', 'user.read'],
    ['/dashboard/staff/ou-1', 'user.read'],
    ['/dashboard/staff?tab=courses', 'user.read'],
    ['/dashboard/status-tracker', 'assignment.read'],
    ['/dashboard/status-tracker#overdue', 'assignment.read'],
    ['/dashboard', null],
    ['/dashboard/staffing', null],
    ['/learn/course-1', null],
    ['/worker/trainings', null],
    [undefined, null],
  ])('%s → %s', (link, permission) => {
    expect(permissionForLink(link)).toBe(permission);
  });

  it('agrees with the named escalation permissions', () => {
    expect(permissionForLink('/dashboard/status-tracker')).toBe(LADDER_ESCALATION_PERMISSION);
    expect(permissionForLink('/dashboard/staff/ou-1')).toBe(REASSIGN_ESCALATION_PERMISSION);
  });
});

describe('roleMayOpenLink — the admin tier against the two gated pages', () => {
  const staffProfile = '/dashboard/staff/ou-1';
  const statusTracker = '/dashboard/status-tracker';

  it.each<[Role, boolean, boolean]>([
    ['owner', true, true],
    ['admin', true, true],
    ['supervisor', true, true],
    ['hr', true, true],
    ['clinical_director', false, true],
    ['finance', false, false],
  ])('%s: staff profile %s, status tracker %s', (role, staff, tracker) => {
    expect(roleMayOpenLink(role, staffProfile)).toBe(staff);
    expect(roleMayOpenLink(role, statusTracker)).toBe(tracker);
  });

  it('narrows nobody for a link that needs nothing beyond the tier', () => {
    expect(roleMayOpenLink('finance', '/dashboard')).toBe(true);
    expect(roleHolds('finance', null)).toBe(true);
  });
});
