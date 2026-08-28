import { getCourseById, getCourseForOrgView } from '@/app/actions/course';
import { isCourseAccessError } from '@/lib/course/access-error';
import type { CourseWithRelations } from '@/types/course';

/**
 * Resolve the course behind the dashboard's course-detail routes, or `null`
 * when the viewer may not see it.
 *
 * Two doors, in order: {@link getCourseById} (creator / enrolled / same-org
 * manager) and, only if that one refuses, {@link getCourseForOrgView} (the
 * global-catalog browse view). The retry is safe ONLY because the second door
 * runs its own role gate — it is a different scope, not a weaker one. If that
 * gate is ever removed, this fallback becomes a bypass again.
 *
 * Every non-access failure is rethrown. The bare `catch` this replaces turned a
 * database outage or a missing session into a 404, hiding real faults behind a
 * page that looked merely empty.
 */
export async function loadCourseDetail(courseId: string): Promise<CourseWithRelations | null> {
  try {
    return await getCourseById(courseId);
  } catch (error) {
    if (!isCourseAccessError(error)) throw error;
  }

  try {
    return await getCourseForOrgView(courseId);
  } catch (error) {
    if (!isCourseAccessError(error)) throw error;
    return null;
  }
}
