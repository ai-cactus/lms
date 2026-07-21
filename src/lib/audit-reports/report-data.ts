import type {
  AllCoursesReportInput,
  AllCoursesReportResult,
  AllStaffReportInput,
  AllStaffReportResult,
  AuditScope,
  CourseReportInput,
  CourseReportResult,
  OrgReportInput,
  OrgReportResult,
  StaffReportInput,
  StaffReportResult,
} from './types';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const rate = (completed: number, total: number): number =>
  total > 0 ? Math.round((completed / total) * 100) : 0;

export function buildCourseReport(input: CourseReportInput): CourseReportResult {
  return {
    scope: 'course',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
    period: input.period,
    course: input.course,
    quizRules: input.quizRules,
    documents: input.documents,
    staffPerformance: input.enrollments.map((e) => ({
      staffName: e.staffName,
      status: e.status,
      score: e.score,
      attempts: e.attempts,
      completedAt: iso(e.completedAt),
    })),
  };
}

export function buildStaffReport(input: StaffReportInput): StaffReportResult {
  return {
    scope: 'staff',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
    period: input.period,
    staff: input.staff,
    transcript: input.enrollments.map((e) => ({
      courseTitle: e.courseTitle,
      type: e.type,
      category: e.category,
      status: e.status,
      score: e.score,
      attempts: e.attempts,
      dateAssigned: e.dateAssigned.toISOString(),
      dateCompleted: iso(e.dateCompleted),
    })),
  };
}

export function buildOrgReport(input: OrgReportInput): OrgReportResult {
  return {
    scope: 'org',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
    period: input.period,
    summary: input.summary,
    activity: input.enrollments.map((e) => ({
      staffName: e.staffName,
      courseTitle: e.courseTitle,
      category: e.category,
      status: e.status,
      score: e.score,
      dateAssigned: e.dateAssigned.toISOString(),
      dateCompleted: iso(e.dateCompleted),
    })),
  };
}

/** Course-centric bulk report: one aggregated row per course. */
export function buildAllCoursesReport(input: AllCoursesReportInput): AllCoursesReportResult {
  return {
    scope: 'all-courses',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
    period: input.period,
    summary: input.summary,
    courses: input.courses.map((c) => ({
      courseTitle: c.courseTitle,
      category: c.category,
      type: c.type,
      status: c.status,
      assignedStaff: c.assignedStaff,
      completed: c.completed,
      completionRate: rate(c.completed, c.assignedStaff),
    })),
  };
}

/** Staff-centric bulk report: one aggregated row per staff member. */
export function buildAllStaffReport(input: AllStaffReportInput): AllStaffReportResult {
  return {
    scope: 'all-staff',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
    period: input.period,
    summary: input.summary,
    staff: input.staff.map((s) => ({
      staffName: s.staffName,
      roleLabel: s.roleLabel,
      email: s.email,
      coursesAssigned: s.coursesAssigned,
      coursesCompleted: s.coursesCompleted,
      completionRate: rate(s.coursesCompleted, s.coursesAssigned),
      lastActivity: iso(s.lastActivity),
    })),
  };
}

/** Prisma `where` for enrollments, by export scope. */
export function resolveEnrollmentFilter(
  scope: AuditScope,
  scopeId: string | undefined,
  orgUserIds: string[],
): Record<string, unknown> {
  if (scope === 'staff') {
    if (!scopeId) throw new Error('resolveEnrollmentFilter: scopeId required for staff scope');
    return { userId: scopeId };
  }
  if (scope === 'course') {
    if (!scopeId) throw new Error('resolveEnrollmentFilter: scopeId required for course scope');
    return { userId: { in: orgUserIds }, courseId: scopeId };
  }
  return { userId: { in: orgUserIds } };
}
