/**
 * "What does a dashboard figure count OVER" — one answer, shared by the Global
 * View, the single-facility view and the Status Tracker.
 *
 * Sharing the POPULATION is not optional. `getDashboardData` once counted only
 * courses the VIEWER had authored while `getGlobalDashboardData` counted the
 * organisation, so one organisation saw different numbers depending on how many
 * facilities it had — hence a predicate bundle rather than another corrected
 * query: a new read has to spread one of these, so it cannot be written unscoped.
 *
 * ⚠️ The viewer's ROLE narrows nothing in this bundle; their FACILITY scope
 * narrows it by CURRENT ROSTER (`OrganizationUserFacility`, active rows). Owner,
 * HR and Finance read the same organisation figures, while a facility-bound
 * supervisor reads their facilities'. What a role may SEE of a population is
 * the caller's decision (`getDashboardData` withholds course rows from a role
 * holding nothing on Courses).
 *
 * ⚠️ Facility attribution is the roster, never `Enrollment.facilityId`. That
 * column is the facility stamped at assignment time; reading it split a
 * transferred member between their old facility (their enrolments) and their
 * new one (their headcount) — BUG-36.
 *
 * ⚠️ `enrollmentWhere` pins the organisation on the MEMBER, not only the course.
 * `OrgCourseOffering` links a course to ANY organisation, so a course predicate
 * alone counts another tenant's learners on an adopted course.
 *
 * ⚠️ The archive filter is a query EXTENSION on Course's own reads (`db/index.ts`)
 * and cannot reach a nested `course:` relation filter, so every nested course
 * predicate here is {@link DashboardScope.liveCourseWhere}.
 */
import type { Prisma } from '@/generated/prisma/client';
import { orgCourseWhere } from '@/lib/course/org-scope';
import { staffPopulationWhere } from '@/lib/dashboard/definitions';
import {
  resolveDataFacilityIdsFor,
  staffFacilityWhere,
  type FacilityScopeSession,
} from '@/lib/facility/staff-where';

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
   * Every course the organisation can use — authored in-house or adopted. The
   * same breadth for every caller (BUG-01). Archive-neutral: for TOP-LEVEL
   * Course reads only, where the query extension excludes archived rows.
   */
  courseWhere: Prisma.CourseWhereInput;
  /** {@link courseWhere} plus the archive predicate, for any nested `course:` filter. */
  liveCourseWhere: Prisma.CourseWhereInput;
  /** The staff population, narrowed to the scope's facilities by current roster. */
  populationWhere: Prisma.OrganizationUserWhereInput;
  /**
   * Enrolments of active, roster-narrowed members on live org courses.
   *
   * Pins the member by `active` + roster rather than by `populationWhere`: an
   * enrolment on a live course already makes an admin-tier holder part of the
   * population, so the two are the same set and this one is the cheaper SQL.
   */
  enrollmentWhere: Prisma.EnrollmentWhereInput;
}

/** A predicate no row can satisfy — the fail-closed value for "no organisation". */
function matchesNothing(): { id: { in: string[] } } {
  return { id: { in: [] } };
}

/**
 * The scope for an already-authorised organisation and facility set. For
 * callers that hold resolved ids rather than a session (the Status Tracker).
 */
export async function buildDashboardScope(input: {
  organizationId: string | null;
  dataFacilityIds: string[] | null;
}): Promise<DashboardScope> {
  const { organizationId, dataFacilityIds } = input;

  if (!organizationId) {
    // Every predicate matches nothing rather than everything, so a read added
    // later without the caller's own early exit still fails closed.
    return {
      organizationId: null,
      dataFacilityIds,
      courseWhere: matchesNothing(),
      liveCourseWhere: matchesNothing(),
      populationWhere: matchesNothing(),
      enrollmentWhere: matchesNothing(),
    };
  }

  const courseWhere = await orgCourseWhere(organizationId);
  // Prisma ANDs sibling fields with the `OR`, so this reads "an org course that
  // is also live", not "an org course or anything live".
  const liveCourseWhere: Prisma.CourseWhereInput = { ...courseWhere, archivedAt: null };
  const rosterWhere = staffFacilityWhere(dataFacilityIds);

  return {
    organizationId,
    dataFacilityIds,
    courseWhere,
    liveCourseWhere,
    populationWhere: staffPopulationWhere({ organizationId, liveCourseWhere, rosterWhere }),
    // `active: true`: a dashboard reports on the CURRENT workforce. removeStaff
    // retains a departed member's in-flight enrolments for compliance (founder
    // Q23); the compliance copy of that data is the auditor pack, not this.
    enrollmentWhere: {
      organizationUser: { organizationId, active: true, ...rosterWhere },
      course: liveCourseWhere,
    },
  };
}

/**
 * @param requestedFacilityIds Narrows every figure to these facilities. Omit (or
 *   pass null) for "the caller's own scope", which is the whole organisation
 *   only for an org-wide role. The value reaches a server action straight from
 *   the client, so it is a request and never a grant: ids the caller cannot view
 *   are dropped, and if that leaves nothing the answer is nothing.
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

  return buildDashboardScope({
    organizationId: organizationId && organizationUserId ? organizationId : null,
    dataFacilityIds,
  });
}
