/**
 * TOOL-30: the course and staff reports name a learner by full name or email
 * and nothing else, so they read only those two User columns — never the whole
 * row, which carries the password hash and MFA secret.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MockWorker, mockRawCourseFindFirst, mockOrgUserFindFirst } = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockRawCourseFindFirst: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('./redis', () => ({ redis: {} }));
vi.mock('./auditor-export-queue', () => ({ AUDITOR_EXPORT_QUEUE_NAME: 'auditor-export' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: { findUnique: vi.fn().mockResolvedValue({ name: 'Acme Health' }) },
    organizationUser: { findFirst: mockOrgUserFindFirst },
    courseVersion: { findMany: vi.fn().mockResolvedValue([]) },
    orgCourseOffering: { findMany: vi.fn().mockResolvedValue([]) },
    job: { findUnique: vi.fn().mockResolvedValue({ payload: {} }), update: vi.fn() },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({ rawPrisma: { course: { findFirst: mockRawCourseFindFirst } } }));
vi.mock('@/lib/audit-reports/report-data', () => ({
  buildCourseReport: vi.fn(() => ({
    scope: 'course',
    course: { title: 'Course' },
    staffPerformance: [],
  })),
  buildStaffReport: vi.fn(() => ({ scope: 'staff', transcript: [] })),
  buildOrgReport: vi.fn(),
  buildAllCoursesReport: vi.fn(),
  buildAllStaffReport: vi.fn(),
}));

import { getExportWorker } from './auditor-export-worker';

type ExportJob = { data: Record<string, unknown>; updateProgress: (p: number) => Promise<void> };
type Processor = (job: ExportJob) => Promise<unknown>;

function processor(): Processor {
  delete (globalThis as unknown as { __auditorWorker?: unknown }).__auditorWorker;
  MockWorker.mockClear();
  getExportWorker();
  return (MockWorker.mock.calls[0] as unknown as [string, Processor])[1];
}

async function runScope(scope: string, scopeId: string) {
  const run = processor()({
    data: { organizationId: 'org-1', dbJobId: 'job-1', scope, scopeId, facilityIds: null },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  });
  await vi.runAllTimersAsync();
  return run;
}

const NAME_AND_EMAIL = { select: { email: true, fullName: true } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

describe('auditor export — learner reads are name and email only (TOOL-30)', () => {
  it('course report', async () => {
    mockRawCourseFindFirst.mockResolvedValue({
      title: 'Bloodborne Pathogens',
      category: 'Compliance',
      type: 'text',
      skillLevel: null,
      status: 'published',
      objectives: [],
      duration: 30,
      quiz: null,
      lessons: [],
      enrollments: [],
    });

    await runScope('course', 'course-1');

    const { include } = mockRawCourseFindFirst.mock.calls[0][0];
    expect(include.enrollments.include.organizationUser).toEqual({
      include: { user: NAME_AND_EMAIL },
    });
  });

  it('staff report', async () => {
    mockOrgUserFindFirst.mockResolvedValue({
      role: 'nurse',
      user: { email: 'nina@acme.test', fullName: 'Nina' },
      enrollments: [],
    });

    await runScope('staff', 'ou-1');

    const { include } = mockOrgUserFindFirst.mock.calls[0][0];
    expect(include.user).toEqual(NAME_AND_EMAIL);
  });
});
