/**
 * Unit tests for courseStatusBadge (Issue #13): the training-details badge
 * used to hardcode "Active" for every course regardless of its real status.
 * `reviewRequired` splits the draft state in two — a course held back by the
 * F-051 quality gate must read "Needs Review", never a plain "Draft" or the
 * old hardcoded "Active".
 */
import { describe, it, expect } from 'vitest';
import { courseStatusBadge } from './course-status-label';

describe('courseStatusBadge', () => {
  it('labels a published course "Active"', () => {
    expect(courseStatusBadge('published', false)).toMatchObject({ label: 'Active' });
  });

  it('labels a draft held by the F-051 quality gate "Needs Review"', () => {
    expect(courseStatusBadge('draft', true)).toMatchObject({ label: 'Needs Review' });
  });

  it('labels an ordinary unpublished draft "Draft"', () => {
    expect(courseStatusBadge('draft', false)).toMatchObject({ label: 'Draft' });
  });

  it('labels anything else (e.g. a soft-deleted/inactive course) "Inactive"', () => {
    expect(courseStatusBadge('inactive', false)).toMatchObject({ label: 'Inactive' });
    expect(courseStatusBadge(null, false)).toMatchObject({ label: 'Inactive' });
    expect(courseStatusBadge(undefined, false)).toMatchObject({ label: 'Inactive' });
  });

  it('a published course ignores reviewRequired — it can never be "Needs Review"', () => {
    expect(courseStatusBadge('published', true)).toMatchObject({ label: 'Active' });
  });
});
