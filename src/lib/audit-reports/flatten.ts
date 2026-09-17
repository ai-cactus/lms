import type { AuditReportResult } from './types';

/**
 * Flatten a report result into the tabular rows the CSV/DOCX formats serialise.
 *
 * ⛔ Shared on purpose, the same way `auditorCatalogueWhere` is. The download
 * route turns these rows into the file; the export worker counts them so the
 * finished-export banner can tell "here is your report" apart from "nothing
 * matched". If the two derived their row sets separately, the banner could
 * promise a download for a result that serialises to a zero-byte CSV — which is
 * exactly the state that used to be reported as an ordinary success.
 */
export function flattenAuditReport(result: AuditReportResult): Record<string, unknown>[] {
  switch (result.scope) {
    case 'org':
      return result.activity.map((a) => ({
        'Staff Name': a.staffName,
        'Course Title': a.courseTitle,
        Category: a.category ?? '',
        Status: a.status,
        Score: a.score ?? 'N/A',
        'Date Assigned': a.dateAssigned,
        'Date Completed': a.dateCompleted ?? '',
      }));
    case 'staff':
      return result.transcript.map((t) => ({
        'Course Title': t.courseTitle,
        Type: t.type,
        Category: t.category ?? '',
        Status: t.status,
        Score: t.score ?? 'N/A',
        Attempts: t.attempts,
        'Date Assigned': t.dateAssigned,
        'Date Completed': t.dateCompleted ?? '',
      }));
    case 'course':
      return result.staffPerformance.map((s) => ({
        'Course Title': result.course.title,
        'Staff Name': s.staffName,
        Status: s.status,
        Score: s.score ?? 'N/A',
        Attempts: s.attempts,
        'Date Completed': s.completedAt ?? '',
      }));
    case 'all-courses':
      return result.courses.map((c) => ({
        'Course Title': c.courseTitle,
        Category: c.category ?? '',
        Type: c.type,
        Status: c.status,
        'Assigned Staff': c.assignedStaff,
        Completed: c.completed,
        'Completion Rate (%)': c.completionRate,
      }));
    case 'all-staff':
      return result.staff.map((s) => ({
        'Staff Name': s.staffName,
        Role: s.roleLabel,
        Email: s.email,
        'Courses Assigned': s.coursesAssigned,
        'Courses Completed': s.coursesCompleted,
        'Completion Rate (%)': s.completionRate,
        'Last Activity': s.lastActivity ?? '',
      }));
  }
}
