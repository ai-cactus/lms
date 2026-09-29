import prisma from '@/lib/prisma';
import { trainingNoticeLink } from '@/lib/notifications/portal-link';

/** `/learn/<courseId>`, optionally followed by a sub-path, query or fragment. */
const LEARN_LINK = /^\/learn\/([^/?#]+)/;

/** The course a notification's link opens directly, or null when it opens none. */
export function learnLinkCourseId(linkUrl: string | null | undefined): string | null {
  return linkUrl ? (LEARN_LINK.exec(linkUrl)?.[1] ?? null) : null;
}

/**
 * Re-point notification links that open a course which can no longer be opened
 * (BUG-24).
 *
 * A notice keeps the link it was written with, and several write `/learn/<id>`
 * — `RETAKE_ASSIGNED` for everyone, the training notices for a manager-category
 * learner (`trainingNoticeLink`). Once that course is archived the link 404s
 * (Q-04: an archived course cannot be opened), while the course still shows,
 * marked Cancelled, on the learner's training list. So an affected link is sent
 * where the recipient's own portal lists their training: the same destination
 * `trainingNoticeLink` gives a notice with no single course to open.
 *
 * Resolved when the inbox is READ rather than rewritten when the course is
 * archived: one batched lookup per page instead of a JSON-path scan of every
 * tenant's notifications at archive time, and the stored link is left intact,
 * so it simply works again if the course is ever restored.
 *
 * The lookup goes through the archive-filtered client ON PURPOSE: a course that
 * is archived — or deleted outright — does not come back, and either way the
 * link is dead. The ids come from the recipient's own notifications and the
 * answer only decides where their link points, so nothing about another tenant
 * can surface through it.
 */
export async function withLiveCourseLinks<T extends { linkUrl: string | null }>(
  notifications: T[],
  recipientRole: string | null | undefined,
): Promise<T[]> {
  const courseIds = [
    ...new Set(
      notifications.flatMap((n) => {
        const courseId = learnLinkCourseId(n.linkUrl);
        return courseId ? [courseId] : [];
      }),
    ),
  ];
  if (courseIds.length === 0) return notifications;

  const live = await prisma.course.findMany({
    where: { id: { in: courseIds } },
    select: { id: true },
  });
  const liveIds = new Set(live.map((course) => course.id));
  if (liveIds.size === courseIds.length) return notifications;

  const fallback = trainingNoticeLink(recipientRole, []);
  return notifications.map((n) => {
    const courseId = learnLinkCourseId(n.linkUrl);
    return courseId && !liveIds.has(courseId) ? { ...n, linkUrl: fallback } : n;
  });
}
