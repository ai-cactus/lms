import { describe, it, expect } from 'vitest';
import { isCourseEditableByOrganization } from './edit-access';

describe('isCourseEditableByOrganization (BUG-11)', () => {
  const orgCourse = { organizationId: 'org-1', isGlobal: false };

  it('admits the organisation that owns the course', () => {
    expect(isCourseEditableByOrganization(orgCourse, 'org-1')).toBe(true);
  });

  it('refuses any other organisation', () => {
    expect(isCourseEditableByOrganization(orgCourse, 'org-2')).toBe(false);
  });

  // Fail closed: a missing org must never read as "matches anything".
  it.each([null, undefined, ''])('refuses a caller with no organisation (%s)', (callerOrg) => {
    expect(isCourseEditableByOrganization(orgCourse, callerOrg)).toBe(false);
  });

  it('refuses a global catalogue course even in the organisation that owns it', () => {
    expect(
      isCourseEditableByOrganization({ organizationId: 'org-1', isGlobal: true }, 'org-1'),
    ).toBe(false);
  });
});
