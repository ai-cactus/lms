/**
 * "What does a dashboard figure count OVER" — one answer, shared by both
 * dashboard actions.
 *
 * The two actions legitimately count different things, so sharing their queries
 * would be wrong. Sharing their POPULATION is not optional. `getDashboardData`
 * counted only courses the VIEWER had personally authored while
 * `getGlobalDashboardData` counted the organisation, so the same organisation saw
 * different numbers depending on how many facilities it had. That is the third
 * recurrence of this class — `getCourses` and `enrollUsers` were each widened for
 * it and this action was missed both times — hence a predicate bundle rather than
 * another corrected query: a new aggregate has to spread one of these, so it
 * cannot be written unscoped.
 *
 * ⚠️ The viewer's ROLE narrows nothing in this bundle; their FACILITY scope
 * narrows the enrolment-derived half of it. That line is the whole contract:
 * "Total Courses" and "Total Staff Assigned" are facts about an organisation, so
 * Owner, HR and Finance must read the same figures — while a facility-bound
 * supervisor legitimately reads their own facilities' figures, because the
 * question they are asking is about those facilities. So facility scope lives on
 * `enrollmentWhere` and `staffWhere`, and neither predicate here is ever
 * conditioned on who is asking. What a role may SEE of a population is the
 * CALLER's decision (`getDashboardData` withholds the course rows and the
 * per-course chart from a role holding nothing on Courses); shrinking the
 * population is how two screens come to describe the same organisation
 * differently.
 *
 * ⚠️ `enrollmentWhere` pins the organisation on the MEMBER, not only the course.
 * `OrgCourseOffering` links a course to ANY organisation, so a course predicate
 * alone counts another tenant's learners on an adopted (or adopted-from) course.
 * Dropping that pin turns a scoping bug into cross-tenant inflation, which is
 * worse because the number merely gets bigger and still looks plausible.
 *
 * ⚠️ The archive filter is a query EXTENSION on Course's own reads (`db/index.ts`),
 * so it reaches `prisma.course.count({ where: courseWhere })` but not
 * `prisma.enrollment.groupBy({ where: { course: courseWhere } })`. That asymmetry
 * put "Total Courses" and every enrolment-derived figure on different populations
 * the moment an organisation archived a course with live enrolments. Both halves
 * of the answer live here: `enrollmentWhere` carries the archive predicate so a
 * new aggregate cannot omit it, and `liveCourseWhere` carries it for the sites
 * that must restate `course:` and would otherwise SHADOW it.
 */
import type { Prisma } from '@/generated/prisma/client';
import { orgCourseWhere } from '@/lib/course/org-scope';
import {
  resolveDataFacilityIdsFor,
  staffFacilityWhere,
  type FacilityScopeSession,
} from '@/lib/facility/staff-where';
import type { Role } from '@/types/next-auth';

export interface DashboardStaffOptions {
  /** Narrow to these membership roles — omit to match every active member. */
  roles?: readonly Role[];
}

export interface DashboardScope {
  /**
   * `null` only for a prospective founder mid-onboarding, who has no
   * organisation yet. Callers skip their queries on it rather than issuing a
   * dozen that can only return empty.
   */
  organizationId: string | null;
  /** The `string[] | null` facility contract, unchanged — see `staff-where.ts`. */
  dataFacilityIds: string[] | null;
  /**
   * Every course the organisation can use — authored in-house or adopted.
   *
   * The SAME breadth for every caller. It was previously narrowed to the
   * viewer's own authored courses for any role without `course.read` — in
   * practice Finance, the one manager role that holds none — so one organisation
   * reported 2 courses to Finance and 4 to its Owner at the same moment, and
   * every enrolment-derived figure hanging off it disagreed too (BUG-01).
   * Courses are org-global rather than facility-bound, so facility scope does
   * not narrow this either.
   *
   * Archive-neutral, because its only callers are TOP-LEVEL Course reads
   * (`course.findMany`, `course.count`) where the query extension already
   * excludes archived rows. Use {@link liveCourseWhere} anywhere the predicate
   * travels through a relation.
   */
  courseWhere: Prisma.CourseWhereInput;
  /**
   * {@link courseWhere} plus the archive predicate, for a NESTED `course:`
   * relation filter — the one position the query extension cannot reach.
   */
  liveCourseWhere: Prisma.CourseWhereInput;
  /** Organisation-pinned, facility-narrowed, archive-excluding. Spread it, never replace it. */
  enrollmentWhere: Prisma.EnrollmentWhereInput;
  /** The active roster, optionally narrowed to some membership roles. */
  staffWhere(options?: DashboardStaffOptions): Prisma.OrganizationUserWhereInput;
}

/** A predicate no row can satisfy — the fail-closed value for "no organisation". */
function matchesNothing(): { id: { in: string[] } } {
  return { id: { in: [] } };
}

/**
 * @param requestedFacilityIds Narrows every enrollment-derived figure to these
 *   facilities. Omit (or pass null) for "the caller's own scope", which is the
 *   whole organisation only for an org-wide role. The value reaches a server
 *   action straight from the client, so it is a request and never a grant: ids
 *   the caller cannot view are dropped, and if that leaves nothing the answer is
 *   nothing rather than everything.
 */
export async function resolveDashboardScope(
  session: FacilityScopeSession,
  requestedFacilityIds?: string[] | null,
): Promise<DashboardScope> {
  const { organizationId, organizationUserId } = session.user;

  const dataFacilityIds = await resolveDataFacilityIdsFor(
    session,
    requestedFacilityIds == null
      ? { kind: 'none' }
      : { kind: 'explicit', ids: requestedFacilityIds },
  );

  if (!organizationId || !organizationUserId) {
    // Every predicate matches nothing rather than everything, so an aggregate
    // added later without the caller's own early exit still fails closed.
    return {
      organizationId: null,
      dataFacilityIds,
      courseWhere: matchesNothing(),
      liveCourseWhere: matchesNothing(),
      enrollmentWhere: matchesNothing(),
      staffWhere: matchesNothing,
    };
  }

  const courseWhere = await orgCourseWhere(organizationId);

  return {
    organizationId,
    dataFacilityIds,
    courseWhere,
    // Prisma ANDs sibling fields with the `OR`, so this reads "an org course
    // that is also live", not "an org course or anything live".
    liveCourseWhere: { ...courseWhere, archivedAt: null },
    // `active: true` matches staffWhere below: a dashboard reports on the
    // CURRENT workforce. removeStaff retains a departed member's in-flight
    // enrollments for compliance (founder Q23) rather than deleting them, so
    // without this they would keep inflating overdue and outstanding-training
    // counts forever. The compliance copy of that data is the auditor pack,
    // which deliberately includes deactivated members and does not use this.
    //
    // `course` is here for the same reason `active` is: archiving retires a
    // course from the catalogue, so its enrolments must stop feeding overdue,
    // at-risk and coverage figures the manager can no longer act on — the
    // course they name is gone from every list. It is deliberately NOT narrowed
    // to the org's catalogue: that is the caller's `liveCourseWhere`, and
    // duplicating it here would make the two disagree on the next change.
    enrollmentWhere: {
      organizationUser: { organizationId, active: true },
      course: { archivedAt: null },
      ...(dataFacilityIds === null ? {} : { facilityId: { in: dataFacilityIds } }),
    },
    staffWhere: (options) => ({
      organizationId,
      active: true,
      ...(options?.roles ? { role: { in: [...options.roles] } } : {}),
      ...staffFacilityWhere(dataFacilityIds),
    }),
  };
}
