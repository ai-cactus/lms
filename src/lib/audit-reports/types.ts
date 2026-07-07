// src/lib/audit-reports/types.ts
// JSON-serializable result shapes stored on Job.result and rendered to PDF.
// All dates are ISO strings so the shape survives JSON round-trips.

export type AuditScope = 'org' | 'course' | 'staff' | 'all-courses' | 'all-staff';

/**
 * Date-range the report was filtered by, surfaced in the PDF header.
 * Bounds are `YYYY-MM-DD` (or ISO) strings; `null` means unbounded on that side.
 * Absent (`undefined`) on a result means no date filter was applied.
 */
export interface ReportPeriod {
  from: string | null;
  to: string | null;
}

export interface StaffPerformanceRow {
  staffName: string;
  status: string;
  score: number | null;
  attempts: number;
  completedAt: string | null;
}

export interface QuizRuleRow {
  title: string;
  passingScore: number;
  allowedAttempts: number | null;
  timeLimit: number | null; // seconds
  questionCount: number;
}

export interface DocumentEvidenceRow {
  name: string;
  version: number;
  hash: string;
}

export interface CourseReportResult {
  scope: 'course';
  generatedAt: string;
  orgName: string;
  period?: ReportPeriod;
  course: {
    title: string;
    category: string | null;
    type: string;
    skillLevel: string | null;
    status: string;
    objectives: string[];
    duration: number | null;
  };
  quizRules: QuizRuleRow[];
  documents: DocumentEvidenceRow[];
  staffPerformance: StaffPerformanceRow[];
}

export interface StaffTranscriptRow {
  courseTitle: string;
  type: string;
  category: string | null;
  status: string;
  score: number | null;
  attempts: number;
  dateAssigned: string;
  dateCompleted: string | null;
}

export interface StaffReportResult {
  scope: 'staff';
  generatedAt: string;
  orgName: string;
  period?: ReportPeriod;
  staff: { name: string; roleLabel: string; email: string };
  transcript: StaffTranscriptRow[];
}

export interface OrgActivityRow {
  staffName: string;
  courseTitle: string;
  category: string | null;
  status: string;
  score: number | null;
  dateAssigned: string;
  dateCompleted: string | null;
}

export interface OrgReportResult {
  scope: 'org';
  generatedAt: string;
  orgName: string;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  activity: OrgActivityRow[];
}

// ── Category-level bulk reports (course-centric / staff-centric) ────────────

export interface AllCoursesRow {
  courseTitle: string;
  category: string | null;
  type: string;
  status: string;
  assignedStaff: number;
  completed: number;
  completionRate: number;
}

export interface AllCoursesReportResult {
  scope: 'all-courses';
  generatedAt: string;
  orgName: string;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  courses: AllCoursesRow[];
}

export interface AllStaffRow {
  staffName: string;
  roleLabel: string;
  email: string;
  coursesAssigned: number;
  coursesCompleted: number;
  completionRate: number;
  lastActivity: string | null;
}

export interface AllStaffReportResult {
  scope: 'all-staff';
  generatedAt: string;
  orgName: string;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  staff: AllStaffRow[];
}

export type AuditReportResult =
  | CourseReportResult
  | StaffReportResult
  | OrgReportResult
  | AllCoursesReportResult
  | AllStaffReportResult;

// ── Builder inputs (plain, DB-agnostic) ────────────────────────────────────

export interface CourseReportInput {
  orgName: string;
  generatedAt: Date;
  period?: ReportPeriod;
  course: CourseReportResult['course'];
  quizRules: QuizRuleRow[];
  documents: DocumentEvidenceRow[];
  enrollments: {
    staffName: string;
    status: string;
    score: number | null;
    attempts: number;
    completedAt: Date | null;
  }[];
}

export interface StaffReportInput {
  orgName: string;
  generatedAt: Date;
  period?: ReportPeriod;
  staff: { name: string; roleLabel: string; email: string };
  enrollments: {
    courseTitle: string;
    type: string;
    category: string | null;
    status: string;
    score: number | null;
    attempts: number;
    dateAssigned: Date;
    dateCompleted: Date | null;
  }[];
}

export interface OrgReportInput {
  orgName: string;
  generatedAt: Date;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  enrollments: {
    staffName: string;
    courseTitle: string;
    category: string | null;
    status: string;
    score: number | null;
    dateAssigned: Date;
    dateCompleted: Date | null;
  }[];
}

export interface AllCoursesReportInput {
  orgName: string;
  generatedAt: Date;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  courses: {
    courseTitle: string;
    category: string | null;
    type: string;
    status: string;
    assignedStaff: number;
    completed: number;
  }[];
}

export interface AllStaffReportInput {
  orgName: string;
  generatedAt: Date;
  period?: ReportPeriod;
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  staff: {
    staffName: string;
    roleLabel: string;
    email: string;
    coursesAssigned: number;
    coursesCompleted: number;
    lastActivity: Date | null;
  }[];
}
