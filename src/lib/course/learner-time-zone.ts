import { DEFAULT_TZ } from '@/lib/reminders/time';

/** The part of a course-roster enrolment the learner's zone is read from. */
interface RosterEnrollment {
  organizationUser: { facilities: readonly { facility: { timezone: string | null } }[] };
}

/**
 * Attach each enrolled learner's own facility zone (BUG-12.3) to a course
 * roster: the zone of their OLDEST active facility, which is the one every
 * deadline writer resolves (`resolveMemberFacility`), falling back to
 * `DEFAULT_TZ`. The roster's `facilities` must be selected oldest first.
 *
 * Must run on the roster as queried, BEFORE any facility-scope narrowing: that
 * narrowing drops the rows outside the viewer's scope, so a supervisor of a
 * learner's second facility would otherwise read that facility's zone and
 * pre-fill a retake date the server (`assignRetake`) would judge differently.
 */
export function withLearnerTimeZones<C extends { enrollments: RosterEnrollment[] }>(
  course: C,
): Omit<C, 'enrollments'> & {
  enrollments: (C['enrollments'][number] & { learnerTimeZone: string })[];
} {
  return {
    ...course,
    enrollments: course.enrollments.map((enrollment) => ({
      ...enrollment,
      learnerTimeZone: enrollment.organizationUser.facilities[0]?.facility.timezone ?? DEFAULT_TZ,
    })),
  };
}
