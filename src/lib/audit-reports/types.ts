// src/lib/audit-reports/types.ts
// JSON-serializable result shapes stored on Job.result and rendered to PDF.
// All dates are ISO strings so the shape survives JSON round-trips.

export type AuditScope = 'org' | 'course' | 'staff';

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
  summary: { totalCourses: number; totalStaff: number; completionRate: number };
  activity: OrgActivityRow[];
}

export type AuditReportResult = CourseReportResult | StaffReportResult | OrgReportResult;

// ── Builder inputs (plain, DB-agnostic) ────────────────────────────────────

export interface CourseReportInput {
  orgName: string;
  generatedAt: Date;
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
