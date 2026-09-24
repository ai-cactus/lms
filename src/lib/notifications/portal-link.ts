import { isAdminRole } from '@/lib/rbac/role-utils';

/**
 * The learner portal's training list. Reaching it needs a WORKER-instance
 * session cookie (see `ROUTE_CONFIG.worker` in src/proxy.ts).
 */
const WORKER_TRAININGS_PATH = '/worker/trainings';

/**
 * Admin home. The only `/dashboard` route every admin-tier role can open —
 * Training, Status Tracker and Staff each need a verb (`course.read`,
 * `assignment.read`, `user.read`) that at least one manager role lacks — and the
 * page that carries the Manage/Learn switcher, which is how an admin-portal
 * session reaches its own learning.
 */
const ADMIN_HOME_PATH = '/dashboard';

/**
 * Where a training notice addressed to ONE enrolled member should point.
 *
 * The two portals are isolated session realms: `/worker/**` is served only
 * against a worker cookie and `/dashboard/**` only against an admin one. A
 * manager can be assigned a course like anyone else, so a notice that always
 * pointed at `/worker/trainings` bounced every manager-category recipient to
 * `/login` while they were signed in (BUG-02).
 *
 * `/learn/[id]` is the one destination that serves both realms: it is outside
 * the proxy's portal matcher and `getLearnPayload` resolves EITHER session, so
 * it opens the assigned course itself on the manager's existing session. A
 * notice covering several courses has no single course to open and no
 * admin-side "my trainings" list to fall back to, so it lands on the dashboard.
 */
export function trainingNoticeLink(
  recipientRole: string | null | undefined,
  courseIds: readonly string[],
): string {
  if (!isAdminRole(recipientRole)) return WORKER_TRAININGS_PATH;
  return courseIds.length === 1 ? `/learn/${courseIds[0]}` : ADMIN_HOME_PATH;
}
