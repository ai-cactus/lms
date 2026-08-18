import { logger, maskEmail } from '@/lib/logger';
import { createNotification } from '@/app/actions/notifications';
import type { DeferredWorkerNotification } from './create';

/** One newly assigned course, as listed in a batched notice. */
export interface AssignedCourse {
  courseId: string;
  courseTitle: string;
  dueAt: Date | null;
}

/** Every course newly assigned to one worker in a single admin action. */
export interface BatchedAssignmentNotice {
  userId: string;
  email: string;
  recipientName: string;
  organizationName: string;
  courses: AssignedCourse[];
}

/**
 * Group deferred payloads into one notice per worker, deduplicating course ids
 * and preserving the order the courses were assigned in (which is the admin's
 * selection order).
 */
export function collectDeferredNotices(
  deferred: readonly DeferredWorkerNotification[],
): BatchedAssignmentNotice[] {
  const byUser = new Map<string, { notice: BatchedAssignmentNotice; courseIds: Set<string> }>();

  for (const item of deferred) {
    let group = byUser.get(item.userId);
    if (!group) {
      group = {
        notice: {
          userId: item.userId,
          email: item.email,
          recipientName: item.recipientName,
          organizationName: item.organizationName,
          courses: [],
        },
        courseIds: new Set<string>(),
      };
      byUser.set(item.userId, group);
    }

    if (group.courseIds.has(item.courseId)) {
      continue;
    }
    group.courseIds.add(item.courseId);
    group.notice.courses.push({
      courseId: item.courseId,
      courseTitle: item.courseTitle,
      dueAt: item.dueAt,
    });
  }

  return [...byUser.values()].map((group) => group.notice);
}

/**
 * Emit exactly ONE in-app notification and ONE email for a worker's batch of
 * newly assigned courses. An empty course list performs no I/O at all.
 *
 * Never throws: the enrollments are already committed, so a failure here must
 * not roll anything back. The notification and the email are attempted
 * independently so one failing never suppresses the other.
 *
 * `notificationCreated` means the in-app write was attempted without throwing —
 * {@link createNotification} itself suppresses per-worker opt-outs internally.
 */
export async function notifyCoursesAssigned(
  notice: BatchedAssignmentNotice,
): Promise<{ emailSent: boolean; notificationCreated: boolean; courseCount: number }> {
  const count = notice.courses.length;
  if (count === 0) {
    return { emailSent: false, notificationCreated: false, courseCount: 0 };
  }

  const titles = notice.courses.map((course) => course.courseTitle);

  let notificationCreated = false;
  try {
    await createNotification({
      userId: notice.userId,
      type: 'COURSE_ASSIGNED',
      title:
        count === 1 ? 'New Required Training Assigned' : `${count} New Required Trainings Assigned`,
      message:
        count === 1
          ? `You have been assigned a new course: ${titles[0]}`
          : `You have been assigned ${count} new courses: ${titles.join(', ')}`,
      linkUrl: `/worker/trainings`,
      metadata: {
        // `courseId` is kept alongside the batched fields so existing consumers
        // of a COURSE_ASSIGNED notification keep working unchanged.
        courseId: notice.courses[0].courseId,
        courseIds: notice.courses.map((course) => course.courseId),
        courseTitles: titles,
        count,
      },
    });
    notificationCreated = true;
  } catch (err) {
    logger.error({
      msg: '[enrollment] Batched course assignment notification failed',
      userId: notice.userId,
      courseCount: count,
      err,
    });
  }

  let emailSent = false;
  try {
    // Dynamic import keeps nodemailer out of any client bundle graph that
    // transitively reaches this module (mirrors createEnrollmentForUser).
    const { sendCoursesAssignedEmail } = await import('@/lib/email');
    const result = await sendCoursesAssignedEmail(
      notice.email,
      notice.recipientName,
      notice.courses.map((course) => ({ title: course.courseTitle, dueAt: course.dueAt })),
      notice.organizationName,
    );
    emailSent = result.success;
  } catch (err) {
    logger.error({
      msg: '[enrollment] Batched course assignment email failed',
      userId: notice.userId,
      email: maskEmail(notice.email),
      courseCount: count,
      err,
    });
  }

  logger.info({
    msg: '[enrollment] Batched course assignment notice emitted',
    userId: notice.userId,
    email: maskEmail(notice.email),
    courseCount: count,
    notificationCreated,
    emailSent,
  });

  return { emailSent, notificationCreated, courseCount: count };
}
