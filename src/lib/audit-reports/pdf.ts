// src/lib/audit-reports/pdf.ts
import {
  createDoc,
  finalize,
  drawTitle,
  drawSectionHeading,
  drawKeyValues,
  drawTable,
  ensureSpace,
  formatDate,
  truncate,
  MARGIN,
  type Column,
} from './pdf-primitives';
import type {
  AuditReportResult,
  CourseReportResult,
  OrgReportResult,
  StaffReportResult,
  StaffPerformanceRow,
  QuizRuleRow,
  StaffTranscriptRow,
  OrgActivityRow,
  AllCoursesReportResult,
  AllCoursesRow,
  AllStaffReportResult,
  AllStaffRow,
  ReportPeriod,
} from './types';

const score = (s: number | null) => (s === null || s === undefined ? '—' : String(s));
const timestamp = (gen: string) =>
  `Generated ${new Date(gen).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })}`;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const periodDate = (value: string): string =>
  new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const periodLabel = (period: ReportPeriod): string => {
  const from = period.from ? periodDate(period.from) : 'Earliest';
  const to = period.to ? periodDate(period.to) : 'Latest';
  return `${from} – ${to}`;
};

/** Header subtitle: generated timestamp, plus the selected period when filtered. */
const subtitle = (gen: string, period?: ReportPeriod): string => {
  const base = timestamp(gen);
  if (!period || (!period.from && !period.to)) return base;
  return `${base}   ·   Period: ${periodLabel(period)}`;
};

export function generateAuditReportPdf(result: AuditReportResult): Promise<Buffer> {
  switch (result.scope) {
    case 'course':
      return renderCourse(result);
    case 'staff':
      return renderStaff(result);
    case 'org':
      return renderOrg(result);
    case 'all-courses':
      return renderAllCourses(result);
    case 'all-staff':
      return renderAllStaff(result);
  }
}

async function renderCourse(r: CourseReportResult): Promise<Buffer> {
  const doc = createDoc(`Course Audit — ${r.course.title}`);
  doc.addPage();
  let y = drawTitle(
    doc,
    `Course Audit — ${r.course.title}`,
    subtitle(r.generatedAt, r.period),
    MARGIN,
  );

  y = drawSectionHeading(doc, 'Course Details', y);
  y = drawKeyValues(
    doc,
    [
      ['Category', r.course.category || '—'],
      ['Type', r.course.type],
      ['Duration (min)', r.course.duration != null ? String(r.course.duration) : '—'],
      ['Objectives', r.course.objectives.length ? r.course.objectives.join('; ') : '—'],
    ],
    y,
  );

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Quiz Rules', y);
  const quizCols: Column<QuizRuleRow>[] = [
    { label: 'Quiz', width: 260, align: 'left', value: (q) => truncate(q.title, 52) },
    { label: 'Passing %', width: 90, align: 'right', value: (q) => String(q.passingScore) },
    {
      label: 'Attempts',
      width: 90,
      align: 'right',
      value: (q) => (q.allowedAttempts != null ? String(q.allowedAttempts) : '∞'),
    },
    {
      label: 'Time Limit',
      width: 110,
      align: 'right',
      value: (q) => (q.timeLimit != null ? `${Math.round(q.timeLimit / 60)} min` : 'None'),
    },
    { label: 'Questions', width: 95, align: 'right', value: (q) => String(q.questionCount) },
  ];
  y = r.quizRules.length
    ? drawTable(doc, quizCols, r.quizRules, y) + 12
    : drawKeyValues(doc, [['', 'No quizzes configured for this course.']], y);

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Staff Performance', y);
  const staffCols: Column<StaffPerformanceRow>[] = [
    { label: 'Staff', width: 240, align: 'left', value: (s) => truncate(s.staffName, 46) },
    { label: 'Status', width: 150, align: 'left', value: (s) => s.status },
    { label: 'Score', width: 80, align: 'right', value: (s) => score(s.score) },
    { label: 'Attempts', width: 90, align: 'right', value: (s) => String(s.attempts) },
    { label: 'Completed', width: 185, align: 'center', value: (s) => formatDate(s.completedAt) },
  ];
  if (r.staffPerformance.length) {
    drawTable(doc, staffCols, r.staffPerformance, y);
  } else {
    drawKeyValues(doc, [['', 'No staff assigned to this course.']], y);
  }

  return finalize(doc, r.orgName);
}

async function renderStaff(r: StaffReportResult): Promise<Buffer> {
  const doc = createDoc(`Staff Audit — ${r.staff.name}`);
  doc.addPage();
  let y = drawTitle(
    doc,
    `Staff Audit — ${r.staff.name}`,
    subtitle(r.generatedAt, r.period),
    MARGIN,
  );

  y = drawSectionHeading(doc, 'Staff', y);
  y = drawKeyValues(
    doc,
    [
      ['Name', r.staff.name],
      ['Role', r.staff.roleLabel],
      ['Email', r.staff.email],
    ],
    y,
  );

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Training Transcript', y);
  const cols: Column<StaffTranscriptRow>[] = [
    { label: 'Course', width: 200, align: 'left', value: (t) => truncate(t.courseTitle, 40) },
    { label: 'Type', width: 55, align: 'left', value: (t) => t.type },
    { label: 'Category', width: 100, align: 'left', value: (t) => truncate(t.category || '—', 18) },
    { label: 'Status', width: 100, align: 'left', value: (t) => t.status },
    { label: 'Score', width: 55, align: 'right', value: (t) => score(t.score) },
    { label: 'Attempts', width: 65, align: 'right', value: (t) => String(t.attempts) },
    { label: 'Assigned', width: 80, align: 'center', value: (t) => formatDate(t.dateAssigned) },
    { label: 'Completed', width: 90, align: 'center', value: (t) => formatDate(t.dateCompleted) },
  ];
  if (r.transcript.length) {
    drawTable(doc, cols, r.transcript, y);
  } else {
    drawKeyValues(doc, [['', 'No enrollments on record.']], y);
  }

  return finalize(doc, r.orgName);
}

async function renderOrg(r: OrgReportResult): Promise<Buffer> {
  const doc = createDoc(`Organization Audit — ${r.orgName}`);
  doc.addPage();
  let y = drawTitle(
    doc,
    `Organization Audit — ${r.orgName}`,
    subtitle(r.generatedAt, r.period),
    MARGIN,
  );

  y = drawSectionHeading(doc, 'Summary', y);
  y = drawKeyValues(
    doc,
    [
      ['Total Courses', String(r.summary.totalCourses)],
      ['Total Staff', String(r.summary.totalStaff)],
      ['Completion Rate', `${r.summary.completionRate}%`],
    ],
    y,
  );

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Activity', y);
  const cols: Column<OrgActivityRow>[] = [
    { label: 'Staff', width: 160, align: 'left', value: (a) => truncate(a.staffName, 32) },
    { label: 'Course', width: 190, align: 'left', value: (a) => truncate(a.courseTitle, 38) },
    { label: 'Category', width: 95, align: 'left', value: (a) => truncate(a.category || '—', 16) },
    { label: 'Status', width: 95, align: 'left', value: (a) => a.status },
    { label: 'Score', width: 45, align: 'right', value: (a) => score(a.score) },
    { label: 'Assigned', width: 75, align: 'center', value: (a) => formatDate(a.dateAssigned) },
    { label: 'Completed', width: 85, align: 'center', value: (a) => formatDate(a.dateCompleted) },
  ];
  if (r.activity.length) {
    drawTable(doc, cols, r.activity, y);
  } else {
    drawKeyValues(doc, [['', 'No activity recorded.']], y);
  }

  return finalize(doc, r.orgName);
}

async function renderAllCourses(r: AllCoursesReportResult): Promise<Buffer> {
  const doc = createDoc(`All Courses Audit — ${r.orgName}`);
  doc.addPage();
  let y = drawTitle(
    doc,
    `All Courses Audit — ${r.orgName}`,
    subtitle(r.generatedAt, r.period),
    MARGIN,
  );

  y = drawSectionHeading(doc, 'Summary', y);
  y = drawKeyValues(
    doc,
    [
      ['Total Courses', String(r.summary.totalCourses)],
      ['Total Staff', String(r.summary.totalStaff)],
      ['Completion Rate', `${r.summary.completionRate}%`],
    ],
    y,
  );

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Courses', y);
  const cols: Column<AllCoursesRow>[] = [
    { label: 'Course', width: 230, align: 'left', value: (c) => truncate(c.courseTitle, 46) },
    { label: 'Category', width: 110, align: 'left', value: (c) => truncate(c.category || '—', 20) },
    { label: 'Type', width: 70, align: 'left', value: (c) => c.type },
    { label: 'Staff', width: 70, align: 'right', value: (c) => String(c.assignedStaff) },
    { label: 'Completed', width: 90, align: 'right', value: (c) => String(c.completed) },
    { label: 'Completion', width: 85, align: 'right', value: (c) => `${c.completionRate}%` },
  ];
  if (r.courses.length) {
    drawTable(doc, cols, r.courses, y);
  } else {
    drawKeyValues(doc, [['', 'No published courses in this organization.']], y);
  }

  return finalize(doc, r.orgName);
}

async function renderAllStaff(r: AllStaffReportResult): Promise<Buffer> {
  const doc = createDoc(`All Staff Audit — ${r.orgName}`);
  doc.addPage();
  let y = drawTitle(
    doc,
    `All Staff Audit — ${r.orgName}`,
    subtitle(r.generatedAt, r.period),
    MARGIN,
  );

  y = drawSectionHeading(doc, 'Summary', y);
  y = drawKeyValues(
    doc,
    [
      ['Total Courses', String(r.summary.totalCourses)],
      ['Total Staff', String(r.summary.totalStaff)],
      ['Completion Rate', `${r.summary.completionRate}%`],
    ],
    y,
  );

  y = ensureSpace(doc, y, 80);
  y = drawSectionHeading(doc, 'Staff', y);
  const cols: Column<AllStaffRow>[] = [
    { label: 'Staff', width: 190, align: 'left', value: (s) => truncate(s.staffName, 38) },
    { label: 'Role', width: 130, align: 'left', value: (s) => truncate(s.roleLabel, 24) },
    { label: 'Assigned', width: 80, align: 'right', value: (s) => String(s.coursesAssigned) },
    { label: 'Completed', width: 85, align: 'right', value: (s) => String(s.coursesCompleted) },
    { label: 'Completion', width: 85, align: 'right', value: (s) => `${s.completionRate}%` },
    {
      label: 'Last Activity',
      width: 95,
      align: 'center',
      value: (s) => formatDate(s.lastActivity),
    },
  ];
  if (r.staff.length) {
    drawTable(doc, cols, r.staff, y);
  } else {
    drawKeyValues(doc, [['', 'No staff members in this organization.']], y);
  }

  return finalize(doc, r.orgName);
}
