import { describe, it, expect } from 'vitest';
import {
  buildCourseReport,
  buildStaffReport,
  buildOrgReport,
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
