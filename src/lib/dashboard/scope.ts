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
 * ⚠️ `enrollmentWhere` pins the organisation on the MEMBER, not only the course.
 * `OrgCourseOffering` links a course to ANY organisation, so a course predicate
 * alone counts another tenant's learners on an adopted (or adopted-from) course.
 * Dropping that pin turns a scoping bug into cross-tenant inflation, which is
 * worse because the number merely gets bigger and still looks plausible.
 */
import type { Prisma } from '@/generated/prisma/client';
import { authoredCourseWhere, listAdoptedCourseIds } from '@/lib/course/org-scope';
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
  /** Every course the organisation can use, at this caller's breadth. */
  courseWhere: Prisma.CourseWhereInput;
  /** Organisation-pinned, facility-narrowed. Spread it, never replace it. */
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
  const { organizationId, organizationUserId, role } = session.user;

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
      enrollmentWhere: matchesNothing(),
      staffWhere: matchesNothing,
    };
  }

  const adoptedCourseIds = await listAdoptedCourseIds(organizationId);
  const authored = authoredCourseWhere({ role, organizationId, organizationUserId });

  return {
    organizationId,
    dataFacilityIds,
    courseWhere:
      adoptedCourseIds.length === 0
        ? authored
        : { OR: [authored, { id: { in: adoptedCourseIds } }] },
    enrollmentWhere: {
      organizationUser: { organizationId },
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
