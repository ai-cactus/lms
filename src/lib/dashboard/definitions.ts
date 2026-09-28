/**
 * One definition per dashboard metric — the Global View, the single-facility
 * view and the Status Tracker all count through this module.
 *
 * Before it existed the two dashboards computed same-named figures over
 * different populations with different maths (BUG-33/34/35/36), so a facility's
 * numbers contradicted the Global ones. The contract now is:
 *
 *  - Population: active worker-role members, plus active admin-tier members who
 *    hold at least one enrolment on a live course ({@link staffPopulationWhere}).
 *  - Attribution: a person — and every enrolment they hold — counts at each
 *    facility where they have an ACTIVE roster row, evaluated at read time
 *    ({@link sliceSnapshot}). `Enrollment.facilityId` (the write-time stamp) is
 *    never read, so a transferred member counts at their current facility only.
 *  - Unfinished: every status except completed/attested ({@link ENROLLMENT_PHASE}).
 *  - Retakes: an enrolment a retake has superseded counts only towards
 *    First-Time Pass Rate ({@link supersededEnrollmentIds}).
 *
 * Each Prisma where-builder here sits next to the in-memory predicate it
 * mirrors, so the Status Tracker (which queries) and the dashboards (which
 * count a loaded snapshot) cannot drift apart.
 *
 * Free of runtime Prisma: the loader is `./snapshot`, which is server-only.
 */
import type { Prisma } from '@/generated/prisma/client';
import type { EnrollmentStatus, RenewalCycle } from '@/generated/prisma/enums';
import { ADMIN_ROLES, WORKER_ROLES } from '@/lib/rbac/role-utils';
import { cycleLengthDays } from '@/lib/reminders/renewal-cycle';
import {
  DEFAULT_PASSING_SCORE,
  passingScoreFor,
  type CoverageCounts,
} from '@/lib/dashboard/metrics';
import {
  DORMANT_LOGIN_DAYS,
  DORMANT_STALLED_DAYS,
  DORMANT_UNSTARTED_DAYS,
  DUE_SOON_WINDOW_DAYS,
  EXPIRING_CREDENTIALS_WINDOW_DAYS,
  RISK_OVERDUE_GRACE_DAYS,
  computeAuditReadinessPercent,
  computeCompletionPercent,
  type FacilityComplianceSignals,
} from '@/lib/facility/metrics';
import type { Role } from '@/types/next-auth';

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBefore(from: Date, days: number): Date {
  return new Date(from.getTime() - days * DAY_MS);
}

export function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

// ── Enrolment phases ────────────────────────────────────────────────────────

export type EnrollmentPhase = 'not_started' | 'in_progress' | 'finished';

/**
 * Every status's phase. A `Record` over the enum, so adding a status is a
 * compile error here rather than a silent miscount on every dashboard.
 *
 * locked / failed / retry_requested are unfinished on purpose: the learner still
 * owes the training, so they stay in overdue, active-learner and coverage
 * figures (founder ruling 2026-09-26) — until a retake supersedes the row
 * ({@link supersededEnrollmentIds}).
 */
export const ENROLLMENT_PHASE: Readonly<Record<EnrollmentStatus, EnrollmentPhase>> = {
  enrolled: 'not_started',
  assigned: 'not_started',
  in_progress: 'in_progress',
  lessons_complete: 'in_progress',
  locked: 'in_progress',
  failed: 'in_progress',
  retry_requested: 'in_progress',
  completed: 'finished',
  attested: 'finished',
};

function statusesIn(phase: EnrollmentPhase): EnrollmentStatus[] {
  return (Object.keys(ENROLLMENT_PHASE) as EnrollmentStatus[]).filter(
    (status) => ENROLLMENT_PHASE[status] === phase,
  );
}

export const FINISHED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = statusesIn('finished');
export const NOT_STARTED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] =
  statusesIn('not_started');

export function isFinishedStatus(status: EnrollmentStatus): boolean {
  return ENROLLMENT_PHASE[status] === 'finished';
}

export function isUnfinishedStatus(status: EnrollmentStatus): boolean {
  return ENROLLMENT_PHASE[status] !== 'finished';
}

/** Mirrors {@link isUnfinishedStatus}. */
export const UNFINISHED_ENROLLMENT_WHERE: Prisma.EnrollmentWhereInput = {
  status: { notIn: [...FINISHED_ENROLLMENT_STATUSES] },
};

// ── Deadlines ───────────────────────────────────────────────────────────────

interface DeadlineFields {
  status: EnrollmentStatus;
  dueAt: Date | null;
}

/**
 * Past due and unfinished — no grace. The ONE overdue definition. Row-level:
 * every caller also drops superseded rows ({@link supersededEnrollmentIds}),
 * which no single row can tell about itself.
 */
export function isOverdue(enrollment: DeadlineFields, now: Date): boolean {
  return (
    enrollment.dueAt !== null &&
    enrollment.dueAt.getTime() < now.getTime() &&
    isUnfinishedStatus(enrollment.status)
  );
}

/** Mirrors {@link isOverdue}. */
export function overdueEnrollmentWhere(now: Date): Prisma.EnrollmentWhereInput {
  return { ...UNFINISHED_ENROLLMENT_WHERE, dueAt: { not: null, lt: now } };
}

/** Unfinished and due within {@link DUE_SOON_WINDOW_DAYS} (inclusive of both ends). */
export function isDueSoon(enrollment: DeadlineFields, now: Date): boolean {
  if (enrollment.dueAt === null || !isUnfinishedStatus(enrollment.status)) return false;
  const due = enrollment.dueAt.getTime();
  return due >= now.getTime() && due <= daysAfter(now, DUE_SOON_WINDOW_DAYS).getTime();
}

/** Mirrors {@link isDueSoon}. */
export function dueSoonEnrollmentWhere(now: Date): Prisma.EnrollmentWhereInput {
  return {
    ...UNFINISHED_ENROLLMENT_WHERE,
    dueAt: { gte: now, lte: daysAfter(now, DUE_SOON_WINDOW_DAYS) },
  };
}

// ── Population ──────────────────────────────────────────────────────────────

export interface PopulationWhereInput {
  organizationId: string;
  /** Org-available and not archived — see `DashboardScope.liveCourseWhere`. */
  liveCourseWhere: Prisma.CourseWhereInput;
  /** Current-roster narrowing (`staffFacilityWhere`), `{}` for the whole organisation. */
  rosterWhere: Prisma.OrganizationUserWhereInput;
}

/**
 * The staff population every dashboard counts over. Admin-tier members are only
 * staff when they are also learners, so an owner who never takes a course does
 * not inflate Total Staff or dilute coverage (BUG-34).
 */
export function staffPopulationWhere({
  organizationId,
  liveCourseWhere,
  rosterWhere,
}: PopulationWhereInput): Prisma.OrganizationUserWhereInput {
  return {
    organizationId,
    active: true,
    ...rosterWhere,
    OR: [
      { role: { in: [...WORKER_ROLES] } },
      { role: { in: [...ADMIN_ROLES] }, enrollments: { some: { course: liveCourseWhere } } },
    ],
  };
}

/**
 * The population as it stood at `asOf`, for the Total Staff trend chip.
 *
 * A reconstruction, and honest about its limits: roles and roster rows are read
 * as they are TODAY (neither is historised), a reactivated member looks
 * continuously employed, and a member deactivated without a `deactivatedAt`
 * (legacy rows) is treated as gone before the window.
 */
export function previousStaffPopulationWhere({
  organizationId,
  liveCourseWhere,
  rosterWhere,
  asOf,
}: PopulationWhereInput & { asOf: Date }): Prisma.OrganizationUserWhereInput {
  return {
    organizationId,
    ...rosterWhere,
    joinedAt: { lt: asOf },
    AND: [
      { OR: [{ active: true }, { deactivatedAt: { gte: asOf } }] },
      {
        OR: [
          { role: { in: [...WORKER_ROLES] } },
          {
            role: { in: [...ADMIN_ROLES] },
            enrollments: { some: { course: liveCourseWhere, startedAt: { lt: asOf } } },
          },
        ],
      },
    ],
  };
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface DashboardMember {
  id: string;
  role: Role;
  joinedAt: Date;
  lastLoginAt: Date | null;
  /** Facilities with an ACTIVE roster row — current attribution, not history. */
  facilityIds: readonly string[];
}

export interface DashboardEnrollment {
  id: string;
  organizationUserId: string;
  courseId: string;
  status: EnrollmentStatus;
  startedAt: Date;
  accessAt: Date | null;
  lastActivityAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  retakeOf: string | null;
}

/** A SUBMITTED quiz attempt (`timeTaken != null`); drafts never reach the snapshot. */
export interface DashboardQuizAttempt {
  enrollmentId: string;
  quizId: string;
  score: number;
  completedAt: Date;
}

/** A certificate whose enrolment belongs to a renewing assignment. */
export interface DashboardCertificate {
  id: string;
  enrollmentId: string;
  organizationUserId: string;
  courseId: string;
  issuedAt: Date;
  renewalCycle: RenewalCycle;
}

/** Everything a dashboard figure is computed from, for one scope at one instant. */
export interface DashboardSlice {
  now: Date;
  members: readonly DashboardMember[];
  enrollments: readonly DashboardEnrollment[];
  attempts: readonly DashboardQuizAttempt[];
  certificates: readonly DashboardCertificate[];
  /** Live, org-available courses with `status = 'published'`. */
  publishedCourseIds: ReadonlySet<string>;
  /** quizId → that quiz's passing score. */
  quizPassingScores: ReadonlyMap<string, number>;
  /** courseId → the course's strictest passing bar (`resolvePassingScores`). */
  coursePassingScores: ReadonlyMap<string, number>;
}

export interface DashboardSnapshot extends DashboardSlice {
  enrollmentsByMember: ReadonlyMap<string, readonly DashboardEnrollment[]>;
  attemptsByEnrollment: ReadonlyMap<string, readonly DashboardQuizAttempt[]>;
  certificatesByMember: ReadonlyMap<string, readonly DashboardCertificate[]>;
  membersByFacility: ReadonlyMap<string, readonly DashboardMember[]>;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = grouped.get(k);
    if (bucket) bucket.push(row);
    else grouped.set(k, [row]);
  }
  return grouped;
}

/** Indexes a loaded slice so per-facility slicing costs O(slice), not O(organisation). */
export function buildSnapshot(slice: DashboardSlice): DashboardSnapshot {
  const membersByFacility = new Map<string, DashboardMember[]>();
  for (const member of slice.members) {
    for (const facilityId of new Set(member.facilityIds)) {
      const bucket = membersByFacility.get(facilityId);
      if (bucket) bucket.push(member);
      else membersByFacility.set(facilityId, [member]);
    }
  }

  return {
    ...slice,
    enrollmentsByMember: groupBy(slice.enrollments, (e) => e.organizationUserId),
    attemptsByEnrollment: groupBy(slice.attempts, (a) => a.enrollmentId),
    certificatesByMember: groupBy(slice.certificates, (c) => c.organizationUserId),
    membersByFacility,
  };
}

/**
 * The part of the snapshot attributed to `facilityIds` by CURRENT roster, or the
 * whole snapshot for `null` — which includes members with no facility row, who
 * count in organisation totals only.
 *
 * A member on two of the requested facilities appears once; a member on one
 * requested and one unrequested facility appears once with all their
 * enrolments (attribution is per person, not per enrolment).
 */
export function sliceSnapshot(
  snapshot: DashboardSnapshot,
  facilityIds: readonly string[] | null,
): DashboardSlice {
  if (facilityIds === null) return snapshot;

  const memberById = new Map<string, DashboardMember>();
  for (const facilityId of facilityIds) {
    for (const member of snapshot.membersByFacility.get(facilityId) ?? []) {
      memberById.set(member.id, member);
    }
  }
  const members = [...memberById.values()];
  const enrollments = members.flatMap((m) => snapshot.enrollmentsByMember.get(m.id) ?? []);
  const attempts = enrollments.flatMap((e) => snapshot.attemptsByEnrollment.get(e.id) ?? []);
  const certificates = members.flatMap((m) => snapshot.certificatesByMember.get(m.id) ?? []);

  return {
    now: snapshot.now,
    members,
    enrollments,
    attempts,
    certificates,
    publishedCourseIds: snapshot.publishedCourseIds,
    quizPassingScores: snapshot.quizPassingScores,
    coursePassingScores: snapshot.coursePassingScores,
  };
}

// ── Retakes ─────────────────────────────────────────────────────────────────

/**
 * Enrolments another enrolment names in `retakeOf` — SUPERSEDED (BUG-38).
 *
 * `assignRetake` opens a new enrolment and leaves the failed one `locked` for
 * good, so from then on the retake carries the obligation. A superseded row is
 * dropped from every obligation, progress and grade figure
 * ({@link withoutSuperseded}) and kept only by First-Time Pass Rate, which
 * measures exactly that failed original attempt. A `locked` row with no retake
 * still counts: that learner is genuinely stuck.
 *
 * A retake belongs to the same member and course as its original, so both
 * always fall in the same scope and the same facility slice. The Status Tracker
 * and the reminder sweep (BUG-44) apply this rule through {@link retakesOfWhere};
 * change them together.
 */
export function supersededEnrollmentIds(
  enrollments: readonly { retakeOf: string | null }[],
): Set<string> {
  const superseded = new Set<string>();
  for (const e of enrollments) {
    if (e.retakeOf !== null) superseded.add(e.retakeOf);
  }
  return superseded;
}

/**
 * Mirrors {@link supersededEnrollmentIds} for a query: AND it with the scope's
 * `enrollmentWhere` to find the in-scope retakes of `ids`. A where-predicate
 * alone cannot express "is named by another row" — `retakeOf` is a plain column
 * with no relation — so callers look the retakes up and filter.
 */
export function retakesOfWhere(ids: readonly string[]): Prisma.EnrollmentWhereInput {
  return { retakeOf: { in: [...ids] } };
}

/** The slice minus superseded enrolments and their attempts — what obligation figures count. */
export function withoutSuperseded(slice: DashboardSlice): DashboardSlice {
  const superseded = supersededEnrollmentIds(slice.enrollments);
  if (superseded.size === 0) return slice;
  return {
    ...slice,
    enrollments: slice.enrollments.filter((e) => !superseded.has(e.id)),
    attempts: slice.attempts.filter((a) => !superseded.has(a.enrollmentId)),
  };
}

// ── Learners & courses ──────────────────────────────────────────────────────

/** Distinct staff with ≥1 unfinished enrolment — Active Learners / Total Assigned Learners. */
export function countActiveLearners(enrollments: readonly DashboardEnrollment[]): number {
  const learners = new Set<string>();
  for (const e of enrollments) {
    if (isUnfinishedStatus(e.status)) learners.add(e.organizationUserId);
  }
  return learners.size;
}

/**
 * Distinct PUBLISHED courses with ≥1 unfinished enrolment — Ongoing Courses /
 * Total Active Courses. A draft or inactive course with legacy enrolments is not
 * "ongoing" in the founder's sense.
 */
export function countActiveCourses(
  enrollments: readonly DashboardEnrollment[],
  publishedCourseIds: ReadonlySet<string>,
): number {
  const courses = new Set<string>();
  for (const e of enrollments) {
    if (isUnfinishedStatus(e.status) && publishedCourseIds.has(e.courseId)) {
      courses.add(e.courseId);
    }
  }
  return courses.size;
}

// ── Scores ──────────────────────────────────────────────────────────────────

/**
 * First-time pass counts: for each (non-retake enrolment, quiz) pair, its
 * EARLIEST submitted attempt, passed when it meets that quiz's passing score.
 *
 * Reads attempts, not `Enrollment.score` — every submit overwrites that column,
 * so it holds the LATEST attempt. A renewal enrolment (`renewedFrom`, not
 * `retakeOf`) is a fresh obligation and its first attempt counts.
 */
export function firstAttemptOutcomes(slice: DashboardSlice): { total: number; passed: number } {
  const firstTimeEnrollmentIds = new Set(
    slice.enrollments.filter((e) => e.retakeOf === null).map((e) => e.id),
  );

  const earliest = new Map<string, DashboardQuizAttempt>();
  for (const attempt of slice.attempts) {
    if (!firstTimeEnrollmentIds.has(attempt.enrollmentId)) continue;
    const key = `${attempt.enrollmentId}:${attempt.quizId}`;
    const current = earliest.get(key);
    if (!current || attempt.completedAt.getTime() < current.completedAt.getTime()) {
      earliest.set(key, attempt);
    }
  }

  let passed = 0;
  for (const attempt of earliest.values()) {
    const bar = slice.quizPassingScores.get(attempt.quizId) ?? DEFAULT_PASSING_SCORE;
    if (attempt.score >= bar) passed++;
  }
  return { total: earliest.size, passed };
}

/** Rounded share, 0 when there is nothing to divide. */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Each enrolment's grade: the mean of its BEST submitted score on each quiz.
 * Enrolments with no submitted attempt are absent — they have no grade, which
 * is different from a grade of zero.
 */
export function enrollmentGrades(attempts: readonly DashboardQuizAttempt[]): Map<string, number> {
  const bestByEnrollmentQuiz = new Map<string, Map<string, number>>();
  for (const attempt of attempts) {
    const byQuiz = bestByEnrollmentQuiz.get(attempt.enrollmentId) ?? new Map<string, number>();
    const best = byQuiz.get(attempt.quizId);
    if (best === undefined || attempt.score > best) byQuiz.set(attempt.quizId, attempt.score);
    bestByEnrollmentQuiz.set(attempt.enrollmentId, byQuiz);
  }

  const grades = new Map<string, number>();
  for (const [enrollmentId, byQuiz] of bestByEnrollmentQuiz) {
    const bests = [...byQuiz.values()];
    grades.set(enrollmentId, bests.reduce((sum, score) => sum + score, 0) / bests.length);
  }
  return grades;
}

/** Average Grade: the rounded mean of {@link enrollmentGrades}, 0 when none are graded. */
export function averageGrade(grades: ReadonlyMap<string, number>): number {
  if (grades.size === 0) return 0;
  let sum = 0;
  for (const grade of grades.values()) sum += grade;
  return Math.round(sum / grades.size);
}

// ── Dormancy ────────────────────────────────────────────────────────────────

function latestOf(dates: readonly (Date | null)[]): number {
  return Math.max(...dates.map((d) => (d ? d.getTime() : Number.NEGATIVE_INFINITY)));
}

/**
 * Dormant when ANY rule trips:
 *  R1 joined ≥ {@link DORMANT_LOGIN_DAYS} ago and no login in that window (or ever);
 *  R2 a not-started enrolment whose latest of (startedAt, accessAt, lastActivityAt)
 *     is ≥ {@link DORMANT_UNSTARTED_DAYS} ago;
 *  R3 a started, unfinished enrolment with no engagement for
 *     {@link DORMANT_STALLED_DAYS} (lastActivityAt, else startedAt).
 *
 * Having no assignment at all is NOT dormant on its own. Not-started is decided
 * by STATUS, never by `lastActivityAt` alone: PR-A backfilled untouched rows'
 * `lastActivityAt` with their creation time, which is not engagement.
 */
export function isDormantMember(
  member: DashboardMember,
  enrollments: readonly DashboardEnrollment[],
  now: Date,
): boolean {
  const loginCutoff = daysBefore(now, DORMANT_LOGIN_DAYS).getTime();
  if (
    member.joinedAt.getTime() <= loginCutoff &&
    (member.lastLoginAt === null || member.lastLoginAt.getTime() < loginCutoff)
  ) {
    return true;
  }

  const unstartedCutoff = daysBefore(now, DORMANT_UNSTARTED_DAYS).getTime();
  const stalledCutoff = daysBefore(now, DORMANT_STALLED_DAYS).getTime();

  return enrollments.some((e) => {
    const phase = ENROLLMENT_PHASE[e.status];
    if (phase === 'not_started') {
      return latestOf([e.startedAt, e.accessAt, e.lastActivityAt]) <= unstartedCutoff;
    }
    if (phase === 'in_progress') {
      return (e.lastActivityAt ?? e.startedAt).getTime() < stalledCutoff;
    }
    return false;
  });
}

// ── Credentials ─────────────────────────────────────────────────────────────

export type CredentialState = 'valid' | 'expiring' | 'expired' | 'superseded';

export function credentialExpiresAt(certificate: DashboardCertificate): Date {
  return daysAfter(certificate.issuedAt, cycleLengthDays(certificate.renewalCycle));
}

/**
 * A certificate's state. Superseded when the same member later FINISHED the
 * same course again — an unfinished renewal does not renew the credential, so
 * a certificate stays expiring/expired until its renewal is completed.
 */
export function classifyCredential(
  certificate: DashboardCertificate,
  memberEnrollments: readonly DashboardEnrollment[],
  now: Date,
): CredentialState {
  const superseded = memberEnrollments.some(
    (e) =>
      e.id !== certificate.enrollmentId &&
      e.courseId === certificate.courseId &&
      isFinishedStatus(e.status) &&
      (e.completedAt ?? e.startedAt).getTime() > certificate.issuedAt.getTime(),
  );
  if (superseded) return 'superseded';

  const expiresAt = credentialExpiresAt(certificate).getTime();
  if (expiresAt < now.getTime()) return 'expired';
  if (expiresAt <= daysAfter(now, EXPIRING_CREDENTIALS_WINDOW_DAYS).getTime()) return 'expiring';
  return 'valid';
}

function countCredentials(slice: DashboardSlice): { expiring: number; expired: number } {
  const byMember = groupBy(slice.enrollments, (e) => e.organizationUserId);
  let expiring = 0;
  let expired = 0;
  for (const certificate of slice.certificates) {
    const state = classifyCredential(
      certificate,
      byMember.get(certificate.organizationUserId) ?? [],
      slice.now,
    );
    if (state === 'expiring') expiring++;
    else if (state === 'expired') expired++;
  }
  return { expiring, expired };
}

// ── Calculators ─────────────────────────────────────────────────────────────

export interface HeadlineFigures {
  totalStaff: number;
  activeLearners: number;
  ongoingCourses: number;
  firstTimePassRate: number;
  overdueTrainings: number;
  dormantStaff: number;
  expiringCredentials: number;
}

/** The Global View's headline tiles (Total Facilities is a count of the scope itself). */
export function computeHeadline(slice: DashboardSlice): HeadlineFigures {
  // First-Time Pass Rate is the one figure that keeps superseded enrolments.
  const firstAttempts = firstAttemptOutcomes(slice);
  const live = withoutSuperseded(slice);
  const byMember = groupBy(live.enrollments, (e) => e.organizationUserId);

  return {
    totalStaff: live.members.length,
    activeLearners: countActiveLearners(live.enrollments),
    ongoingCourses: countActiveCourses(live.enrollments, live.publishedCourseIds),
    firstTimePassRate: percentOf(firstAttempts.passed, firstAttempts.total),
    overdueTrainings: live.enrollments.filter((e) => isOverdue(e, live.now)).length,
    dormantStaff: live.members.filter((m) => isDormantMember(m, byMember.get(m.id) ?? [], live.now))
      .length,
    expiringCredentials: countCredentials(live).expiring,
  };
}

export interface CourseFigures {
  /** Assignments on the course. */
  total: number;
  finished: number;
  /** Graded enrolments meeting / missing the course's strictest bar. */
  passCount: number;
  failCount: number;
  /** Rounded mean of the graded enrolments' grades, 0 when none. */
  meanGrade: number;
}

export interface FacilityViewFigures {
  totalActiveCourses: number;
  totalAssignedLearners: number;
  averageGrade: number;
  /** Assignment counts per phase — the donut is per ASSIGNMENT, not per person (BUG-33). */
  coverage: CoverageCounts;
  totalAssignments: number;
  byCourse: Map<string, CourseFigures>;
}

/** The single-facility view: three tiles, the coverage donut and per-course figures. */
export function computeFacilityView(fullSlice: DashboardSlice): FacilityViewFigures {
  const slice = withoutSuperseded(fullSlice);
  const grades = enrollmentGrades(slice.attempts);
  const coverage: CoverageCounts = { completed: 0, inProgress: 0, notStarted: 0 };
  const byCourse = new Map<string, CourseFigures & { gradeSum: number }>();

  for (const e of slice.enrollments) {
    const phase = ENROLLMENT_PHASE[e.status];
    if (phase === 'finished') coverage.completed++;
    else if (phase === 'in_progress') coverage.inProgress++;
    else coverage.notStarted++;

    const course = byCourse.get(e.courseId) ?? {
      total: 0,
      finished: 0,
      passCount: 0,
      failCount: 0,
      meanGrade: 0,
      gradeSum: 0,
    };
    course.total++;
    if (phase === 'finished') course.finished++;
    const grade = grades.get(e.id);
    if (grade !== undefined) {
      course.gradeSum += grade;
      if (grade >= passingScoreFor(slice.coursePassingScores, e.courseId)) course.passCount++;
      else course.failCount++;
    }
    byCourse.set(e.courseId, course);
  }

  const figures = new Map<string, CourseFigures>();
  for (const [courseId, { gradeSum, ...course }] of byCourse) {
    const graded = course.passCount + course.failCount;
    figures.set(courseId, { ...course, meanGrade: graded > 0 ? Math.round(gradeSum / graded) : 0 });
  }

  return {
    totalActiveCourses: countActiveCourses(slice.enrollments, slice.publishedCourseIds),
    totalAssignedLearners: countActiveLearners(slice.enrollments),
    averageGrade: averageGrade(grades),
    coverage,
    totalAssignments: slice.enrollments.length,
    byCourse: figures,
  };
}

export interface FacilityRowFigures {
  staffCount: number;
  activeLearners: number;
  activeCourses: number;
  /** Unfinished assignments. */
  activeTrainings: number;
  averageGrade: number;
  overdueTrainings: number;
  approachingDeadlines: number;
  /** Finished ÷ assigned, 0 when nothing is assigned. */
  completionPercent: number;
  auditReadinessPercent: number;
  signals: FacilityComplianceSignals;
}

/** One facility's row in the Global View tables, over the same slice as its facility view. */
export function computeFacilityRow(fullSlice: DashboardSlice): FacilityRowFigures {
  const slice = withoutSuperseded(fullSlice);
  const { now, enrollments } = slice;
  const graceCutoff = daysBefore(now, RISK_OVERDUE_GRACE_DAYS).getTime();

  let finished = 0;
  let overdue = 0;
  let overdueBeyondGrace = 0;
  let approaching = 0;
  let withDeadline = 0;
  let onTime = 0;
  for (const e of enrollments) {
    const done = isFinishedStatus(e.status);
    if (done) finished++;
    if (isOverdue(e, now)) {
      overdue++;
      if ((e.dueAt as Date).getTime() < graceCutoff) overdueBeyondGrace++;
    }
    if (isDueSoon(e, now)) approaching++;
    if (e.dueAt !== null) {
      withDeadline++;
      if (done && e.completedAt !== null && e.completedAt.getTime() <= e.dueAt.getTime()) {
        onTime++;
      }
    }
  }

  const credentials = countCredentials(slice);

  return {
    staffCount: slice.members.length,
    activeLearners: countActiveLearners(enrollments),
    activeCourses: countActiveCourses(enrollments, slice.publishedCourseIds),
    activeTrainings: enrollments.length - finished,
    averageGrade: averageGrade(enrollmentGrades(slice.attempts)),
    overdueTrainings: overdue,
    approachingDeadlines: approaching,
    completionPercent: computeCompletionPercent(finished, enrollments.length),
    auditReadinessPercent: computeAuditReadinessPercent(onTime, withDeadline),
    signals: {
      overdueBeyondGrace,
      overdueWithinGrace: overdue - overdueBeyondGrace,
      completionPercent:
        enrollments.length > 0 ? computeCompletionPercent(finished, enrollments.length) : null,
      expiredCredentials: credentials.expired,
      expiringCredentials: credentials.expiring,
    },
  };
}
