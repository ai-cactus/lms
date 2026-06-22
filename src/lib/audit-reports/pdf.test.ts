import { describe, it, expect } from 'vitest';
import { generateAuditReportPdf } from './pdf';
import type { CourseReportResult, StaffReportResult, OrgReportResult } from './types';

const isPdf = (b: Buffer) => b.length > 0 && b.subarray(0, 5).toString() === '%PDF-';

describe('generateAuditReportPdf', () => {
  it('renders a course report to a PDF buffer', async () => {
    const r: CourseReportResult = {
      scope: 'course',
      generatedAt: '2026-06-19T10:00:00.000Z',
      orgName: 'Acme',
      course: {
        title: 'HIPAA Privacy Training',
        category: 'Compliance',
        type: 'text',
        skillLevel: 'beginner',
        status: 'published',
        objectives: ['Understand PHI'],
        duration: 30,
      },
      quizRules: [
        { title: 'Final', passingScore: 70, allowedAttempts: 2, timeLimit: 600, questionCount: 10 },
      ],
      documents: [{ name: 'policy.pdf', version: 1, hash: 'abcdef123456' }],
      staffPerformance: [
        {
          staffName: 'Jane Doe',
          status: 'completed',
          score: 95,
          attempts: 1,
          completedAt: '2026-06-18T10:00:00.000Z',
        },
      ],
    };
    expect(isPdf(await generateAuditReportPdf(r))).toBe(true);
  });

  it('renders a staff report (and an empty transcript) to a PDF buffer', async () => {
    const r: StaffReportResult = {
      scope: 'staff',
      generatedAt: '2026-06-19T10:00:00.000Z',
      orgName: 'Acme',
      staff: { name: 'Jane Doe', roleLabel: 'Compliance Officer', email: 'jane@acme.com' },
      transcript: [],
    };
    expect(isPdf(await generateAuditReportPdf(r))).toBe(true);
  });

  it('renders an org report to a PDF buffer', async () => {
    const r: OrgReportResult = {
      scope: 'org',
      generatedAt: '2026-06-19T10:00:00.000Z',
      orgName: 'Acme',
      summary: { totalCourses: 5, totalStaff: 8, completionRate: 80 },
      activity: [
        {
          staffName: 'Jane',
          courseTitle: 'HIPAA',
          category: 'Compliance',
          status: 'completed',
          score: 95,
          dateAssigned: '2026-06-01T10:00:00.000Z',
          dateCompleted: '2026-06-10T10:00:00.000Z',
        },
      ],
    };
    expect(isPdf(await generateAuditReportPdf(r))).toBe(true);
  });
});
