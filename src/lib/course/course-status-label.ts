/**
 * Returns the human-readable label and Badge classes for a course's lifecycle
 * state. `reviewRequired` splits draft in two: the F-051 quality gate holds a
 * flagged course as a draft until an admin acknowledges its warnings, which
 * reads very differently from a draft the author simply has not published.
 */
export interface CourseStatusBadge {
  label: string;
  /** Extra classes layered on `<Badge variant="outline">`; empty when neutral. */
  className: string;
}

export function courseStatusBadge(
  status: string | null | undefined,
  reviewRequired: boolean,
): CourseStatusBadge {
  if (status === 'published') {
    return { label: 'Active', className: 'border-success/30 bg-success/10 text-foreground' };
  }
  if (status === 'draft') {
    return reviewRequired
      ? { label: 'Needs Review', className: 'border-warning/30 bg-warning/10 text-foreground' }
      : { label: 'Draft', className: '' };
  }
  return { label: 'Inactive', className: '' };
}
