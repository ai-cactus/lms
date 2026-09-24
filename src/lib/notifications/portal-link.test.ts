/**
 * BUG-02. `/worker/**` is served only against a worker-instance session cookie
 * and `/dashboard/**` only against an admin one (src/proxy.ts), so a training
 * notice that always pointed at `/worker/trainings` bounced every
 * manager-category recipient to `/login` while they were signed in.
 */
import { describe, it, expect } from 'vitest';
import { trainingNoticeLink } from './portal-link';
import { ADMIN_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';

describe('trainingNoticeLink', () => {
  it.each(WORKER_ROLES)('sends a %s learner to their own training list', (role) => {
    expect(trainingNoticeLink(role, ['course-1'])).toBe('/worker/trainings');
    expect(trainingNoticeLink(role, ['course-1', 'course-2'])).toBe('/worker/trainings');
  });

  it.each(ADMIN_ROLES)('opens the assigned course itself for a %s', (role) => {
    expect(trainingNoticeLink(role, ['course-1'])).toBe('/learn/course-1');
  });

  it.each(ADMIN_ROLES)('falls back to the dashboard for a %s with several courses', (role) => {
    expect(trainingNoticeLink(role, ['course-1', 'course-2'])).toBe('/dashboard');
  });

  it('gives a manager and a learner different destinations for the SAME assignment', () => {
    expect(trainingNoticeLink('clinical_director', ['course-1'])).not.toBe(
      trainingNoticeLink('nurse', ['course-1']),
    );
  });

  it('treats an unknown or missing role as a learner — the safe default is the portal every non-manager uses', () => {
    expect(trainingNoticeLink(null, ['course-1'])).toBe('/worker/trainings');
    expect(trainingNoticeLink(undefined, ['course-1'])).toBe('/worker/trainings');
    expect(trainingNoticeLink('not_a_role', ['course-1'])).toBe('/worker/trainings');
  });

  it('never leaves a manager without a destination when the course list is empty', () => {
    expect(trainingNoticeLink('owner', [])).toBe('/dashboard');
  });
});
