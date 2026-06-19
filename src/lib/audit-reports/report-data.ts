// src/lib/audit-reports/report-data.ts
import type {
  AuditScope,
  CourseReportInput,
  CourseReportResult,
  OrgReportInput,
  OrgReportResult,
  StaffReportInput,
  StaffReportResult,
} from './types';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function buildCourseReport(input: CourseReportInput): CourseReportResult {
  return {
    scope: 'course',
    generatedAt: input.generatedAt.toISOString(),
    orgName: input.orgName,
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
