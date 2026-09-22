import { describe, it, expect } from 'vitest';
import { courseListStatus } from './course-list-status';

describe('courseListStatus', () => {
  it('labels a draft as Draft regardless of enrollments', () => {
    expect(courseListStatus('draft', 0)).toEqual({ key: 'draft', label: 'Draft' });
    expect(courseListStatus('draft', 4)).toEqual({ key: 'draft', label: 'Draft' });
  });

  it('labels a published course nobody is enrolled in as Published', () => {
    expect(courseListStatus('published', 0)).toEqual({ key: 'published', label: 'Published' });
  });

  it('labels a published course with at least one enrollment as Assigned', () => {
    expect(courseListStatus('published', 1)).toEqual({ key: 'assigned', label: 'Assigned' });
    expect(courseListStatus('published', 37)).toEqual({ key: 'assigned', label: 'Assigned' });
  });

  it('labels an inactive course as Inactive, even when it has enrollments', () => {
    expect(courseListStatus('inactive', 0)).toEqual({ key: 'inactive', label: 'Inactive' });
    expect(courseListStatus('inactive', 12)).toEqual({ key: 'inactive', label: 'Inactive' });
  });

  it('never presents an unknown or missing status as live', () => {
    expect(courseListStatus('archived', 3)).toEqual({ key: 'inactive', label: 'Inactive' });
    expect(courseListStatus('', 3)).toEqual({ key: 'inactive', label: 'Inactive' });
    expect(courseListStatus(null, 3)).toEqual({ key: 'inactive', label: 'Inactive' });
    expect(courseListStatus(undefined, 0)).toEqual({ key: 'inactive', label: 'Inactive' });
  });
});
