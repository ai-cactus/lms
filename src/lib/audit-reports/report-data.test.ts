import { describe, it, expect } from 'vitest';
import {
  buildCourseReport,
  buildStaffReport,
  buildOrgReport,
  buildAllCoursesReport,
  buildAllStaffReport,
  resolveEnrollmentFilter,
} from './report-data';

const GEN = new Date('2026-06-19T10:00:00.000Z');

describe('buildCourseReport', () => {
  it('maps input to a course-scoped result with ISO dates', () => {
    const result = buildCourseReport({
      orgName: 'Acme',
      generatedAt: GEN,
      course: {
        title: 'HIPAA',
        category: 'Compliance',
        type: 'text',
        skillLevel: 'beginner',
        status: 'published',
        objectives: ['a', 'b'],
        duration: 30,
      },
      quizRules: [
        { title: 'Final', passingScore: 70, allowedAttempts: 2, timeLimit: 600, questionCount: 10 },
      ],
      documents: [{ name: 'policy.pdf', version: 1, hash: 'abc' }],
      enrollments: [
        { staffName: 'Jane', status: 'completed', score: 95, attempts: 1, completedAt: GEN },
        { staffName: 'Bob', status: 'assigned', score: null, attempts: 0, completedAt: null },
      ],
    });

    expect(result.scope).toBe('course');
    expect(result.generatedAt).toBe(GEN.toISOString());
    expect(result.course.title).toBe('HIPAA');
    expect(result.quizRules[0].questionCount).toBe(10);
    expect(result.documents[0].hash).toBe('abc');
    expect(result.staffPerformance[0].completedAt).toBe(GEN.toISOString());
    expect(result.staffPerformance[1].completedAt).toBeNull();
  });
});

describe('buildStaffReport', () => {
  it('maps input to a staff-scoped result', () => {
    const result = buildStaffReport({
      orgName: 'Acme',
      generatedAt: GEN,
      staff: { name: 'Jane', roleLabel: 'Compliance Officer', email: 'jane@acme.com' },
      enrollments: [
        {
          courseTitle: 'HIPAA',
          type: 'text',
          category: 'Compliance',
          status: 'completed',
          score: 95,
          attempts: 2,
          dateAssigned: GEN,
          dateCompleted: GEN,
        },
      ],
    });

    expect(result.scope).toBe('staff');
    expect(result.staff.roleLabel).toBe('Compliance Officer');
    expect(result.transcript[0].dateAssigned).toBe(GEN.toISOString());
    expect(result.transcript[0].attempts).toBe(2);
  });
});

describe('buildOrgReport', () => {
  it('maps input to an org-scoped result with summary', () => {
    const result = buildOrgReport({
      orgName: 'Acme',
      generatedAt: GEN,
      summary: { totalCourses: 5, totalStaff: 8, completionRate: 80 },
      enrollments: [
        {
          staffName: 'Jane',
          courseTitle: 'HIPAA',
          category: 'Compliance',
          status: 'completed',
          score: 95,
          dateAssigned: GEN,
          dateCompleted: GEN,
        },
      ],
    });

    expect(result.scope).toBe('org');
    expect(result.summary.completionRate).toBe(80);
    expect(result.activity).toHaveLength(1);
    expect(result.activity[0].dateCompleted).toBe(GEN.toISOString());
  });
});

describe('buildAllCoursesReport', () => {
  it('maps input to a course-centric bulk result with a per-course completion rate', () => {
    const result = buildAllCoursesReport({
      orgName: 'Acme',
      generatedAt: GEN,
      summary: { totalCourses: 2, totalStaff: 10, completionRate: 60 },
      courses: [
        {
          courseTitle: 'HIPAA',
          category: 'Compliance',
          type: 'text',
          status: 'published',
          assignedStaff: 10,
          completed: 6,
        },
        {
          courseTitle: 'Fire Safety',
          category: 'Safety',
          type: 'video',
          status: 'draft',
          assignedStaff: 0,
          completed: 0,
        },
      ],
    });

    expect(result.scope).toBe('all-courses');
    expect(result.generatedAt).toBe(GEN.toISOString());
    expect(result.courses).toHaveLength(2);
    // Category is category-distinct across rows — not collapsed/aggregated together.
    expect(result.courses[0].category).toBe('Compliance');
    expect(result.courses[1].category).toBe('Safety');
    expect(result.courses[0].completionRate).toBe(60); // 6/10 -> 60%
    // Zero-assigned course must not divide by zero.
    expect(result.courses[1].completionRate).toBe(0);
  });
});

describe('buildAllStaffReport', () => {
  it('maps input to a staff-centric bulk result with a per-staff completion rate and ISO lastActivity', () => {
    const result = buildAllStaffReport({
      orgName: 'Acme',
      generatedAt: GEN,
      summary: { totalCourses: 5, totalStaff: 2, completionRate: 50 },
      staff: [
        {
          staffName: 'Jane',
          roleLabel: 'Compliance Officer',
          email: 'jane@acme.com',
          coursesAssigned: 4,
          coursesCompleted: 2,
          lastActivity: GEN,
        },
        {
          staffName: 'Bob',
          roleLabel: 'Worker',
          email: 'bob@acme.com',
          coursesAssigned: 0,
          coursesCompleted: 0,
          lastActivity: null,
        },
      ],
    });

    expect(result.scope).toBe('all-staff');
    expect(result.staff).toHaveLength(2);
    expect(result.staff[0].completionRate).toBe(50); // 2/4 -> 50%
    expect(result.staff[0].lastActivity).toBe(GEN.toISOString());
    expect(result.staff[1].completionRate).toBe(0); // no assigned courses -> 0, not NaN
    expect(result.staff[1].lastActivity).toBeNull();
  });
});

describe('report period propagation', () => {
  it('omits period by default (all-time reports have no period)', () => {
    const result = buildOrgReport({
      orgName: 'Acme',
      generatedAt: GEN,
      summary: { totalCourses: 1, totalStaff: 1, completionRate: 0 },
      enrollments: [],
    });
    expect(result.period).toBeUndefined();
  });

  it('carries the selected period onto the report result', () => {
    const period = { from: '2026-06-01', to: '2026-06-30' };
    const result = buildAllStaffReport({
      orgName: 'Acme',
      generatedAt: GEN,
      period,
      summary: { totalCourses: 5, totalStaff: 0, completionRate: 0 },
      staff: [],
    });
    expect(result.period).toEqual(period);
  });
});

describe('resolveEnrollmentFilter', () => {
  const orgUserIds = ['u1', 'u2', 'u3'];

  it('org scope filters by all org users', () => {
    expect(resolveEnrollmentFilter('org', undefined, orgUserIds)).toEqual({
      userId: { in: orgUserIds },
    });
  });

  it('course scope adds courseId', () => {
    expect(resolveEnrollmentFilter('course', 'c1', orgUserIds)).toEqual({
      userId: { in: orgUserIds },
      courseId: 'c1',
    });
  });

  it('staff scope filters by single user', () => {
    expect(resolveEnrollmentFilter('staff', 'u2', orgUserIds)).toEqual({
      userId: 'u2',
    });
  });
});
