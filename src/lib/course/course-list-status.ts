export type CourseListStatusKey = 'draft' | 'published' | 'assigned' | 'inactive';

export interface CourseListStatus {
  key: CourseListStatusKey;
  label: string;
}

/**
 * The status shown on course LIST rows. Deliberately separate from
 * `courseStatusLabel`, which words the detail/preview pages ("Active",
 * "Needs Review"): the list splits a published course by whether anyone has
 * been assigned it yet.
 *
 * Anything that is not `draft` or `published` — `inactive`, a missing value or
 * a status added later — reads as Inactive, so an unrecognised course is never
 * presented as live.
 */
export function courseListStatus(
  status: string | null | undefined,
  enrollmentsCount: number,
): CourseListStatus {
  if (status === 'draft') return { key: 'draft', label: 'Draft' };
  if (status === 'published') {
    return enrollmentsCount >= 1
      ? { key: 'assigned', label: 'Assigned' }
      : { key: 'published', label: 'Published' };
  }
  return { key: 'inactive', label: 'Inactive' };
}
