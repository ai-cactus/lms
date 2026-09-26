import 'server-only';
import prisma from '@/lib/prisma';
import { resolvePassingScores } from '@/lib/dashboard/metrics';
import {
  buildSnapshot,
  previousStaffPopulationWhere,
  type DashboardSnapshot,
} from '@/lib/dashboard/definitions';
import type { DashboardScope } from '@/lib/dashboard/scope';
import { staffFacilityWhere } from '@/lib/facility/staff-where';
import type { Role } from '@/types/next-auth';

/**
 * Loads everything a dashboard figure is computed from, for one scope at one
 * instant: a FIXED set of bulk queries in one `Promise.all`, independent of the
 * number of facilities (no N+1 — a 3-site and a 300-site customer issue the
 * same work). Every figure is then counted in memory by
 * `@/lib/dashboard/definitions`.
 *
 * Why rows rather than `groupBy`: Prisma cannot group by a relation (current
 * roster attribution), and dormancy, first attempts, best scores and
 * certificate supersession all need row-level data. The selects are narrow —
 * roughly 50k small rows for the largest expected organisation. If an
 * organisation outgrows that (>200k enrolments), move the enrolment and attempt
 * reads to a `$queryRaw` that pre-aggregates per member rather than widening
 * these selects.
 */
export async function loadDashboardSnapshot(
  scope: DashboardScope,
  now: Date,
): Promise<DashboardSnapshot> {
  if (!scope.organizationId) {
    return buildSnapshot({
      now,
      members: [],
      enrollments: [],
      attempts: [],
      certificates: [],
      publishedCourseIds: new Set(),
      quizPassingScores: new Map(),
      coursePassingScores: new Map(),
    });
  }

  const [members, enrollments, attempts, certificates, publishedCourses, quizzes] =
    await Promise.all([
      prisma.organizationUser.findMany({
        where: scope.populationWhere,
        select: {
          id: true,
          role: true,
          joinedAt: true,
          lastLoginAt: true,
          facilities: { where: { active: true }, select: { facilityId: true } },
        },
      }),
      prisma.enrollment.findMany({
        where: scope.enrollmentWhere,
        select: {
          id: true,
          organizationUserId: true,
          courseId: true,
          status: true,
          startedAt: true,
          accessAt: true,
          lastActivityAt: true,
          dueAt: true,
          completedAt: true,
          retakeOf: true,
        },
      }),
      // Submitted attempts only: a draft (`timeTaken` null) is working state
      // that the submit route replaces, not an attempt the learner made.
      prisma.quizAttempt.findMany({
        where: { timeTaken: { not: null }, enrollment: scope.enrollmentWhere },
        select: { enrollmentId: true, quizId: true, score: true, completedAt: true },
      }),
      prisma.certificate.findMany({
        where: {
          enrollment: { ...scope.enrollmentWhere, assignment: { renewalCycle: { not: 'none' } } },
        },
        select: {
          id: true,
          enrollmentId: true,
          organizationUserId: true,
          courseId: true,
          issuedAt: true,
          enrollment: { select: { assignment: { select: { renewalCycle: true } } } },
        },
      }),
      prisma.course.findMany({
        where: { ...scope.liveCourseWhere, status: 'published' },
        select: { id: true },
      }),
      // A quiz hangs off either a lesson or the course directly, so both
      // attachment points are resolved back to a course.
      prisma.quiz.findMany({
        where: {
          OR: [{ course: scope.liveCourseWhere }, { lesson: { course: scope.liveCourseWhere } }],
        },
        select: {
          id: true,
          passingScore: true,
          courseId: true,
          lesson: { select: { courseId: true } },
        },
      }),
    ]);

  return buildSnapshot({
    now,
    members: members.map((member) => ({
      id: member.id,
      role: member.role as Role,
      joinedAt: member.joinedAt,
      lastLoginAt: member.lastLoginAt,
      facilityIds: member.facilities.map((row) => row.facilityId),
    })),
    enrollments,
    attempts,
    certificates: certificates.flatMap(({ enrollment, ...certificate }) =>
      enrollment.assignment
        ? [{ ...certificate, renewalCycle: enrollment.assignment.renewalCycle }]
        : [],
    ),
    publishedCourseIds: new Set(publishedCourses.map((course) => course.id)),
    quizPassingScores: new Map(quizzes.map((quiz) => [quiz.id, quiz.passingScore])),
    coursePassingScores: resolvePassingScores(quizzes),
  });
}

/**
 * The Total Staff population as it stood at `asOf`, for its trend chip — see
 * `previousStaffPopulationWhere` for what the reconstruction can and cannot see.
 */
export async function countPreviousStaffPopulation(
  scope: DashboardScope,
  asOf: Date,
): Promise<number> {
  if (!scope.organizationId) return 0;
  return prisma.organizationUser.count({
    where: previousStaffPopulationWhere({
      organizationId: scope.organizationId,
      liveCourseWhere: scope.liveCourseWhere,
      rosterWhere: staffFacilityWhere(scope.dataFacilityIds),
      asOf,
    }),
  });
}
