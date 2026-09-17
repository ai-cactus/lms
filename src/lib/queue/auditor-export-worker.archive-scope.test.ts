/**
 * The auditor export must see ARCHIVED courses.
 *
 * Q24 turned "delete a course" into an archive write, and the app's Prisma
 * client carries a query extension that hides archived rows from every
 * top-level read (`db/index.ts`). A compliance export read through that client
 * is quietly incomplete and still looks correct — the worst possible failure
 * mode for an audit artifact, and one no amount of downstream assertion catches
 * because the missing rows never arrive.
 *
 * So this worker reads Course off `rawPrisma`. These tests pin that by giving
 * the two clients DIFFERENT spies: the filtered one is wired to return nothing,
 * exactly as it would for an archived course, so a regression that swaps them
 * produces an empty report rather than an equivalent one.
 *
 * `prisma.course` is deliberately ABSENT from the `@/lib/prisma` mock for the
 * count branches — a regression there would throw rather than silently pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  MockWorker,
  mockRawCourseFindMany,
  mockRawCourseCount,
  mockFilteredCourseFindMany,
  mockFilteredCourseCount,
  mockOrgUserCount,
  mockOrgUserFindMany,
  mockEnrollmentFindMany,
  mockOrgFindUnique,
  mockOfferingFindMany,
  mockJobFindUnique,
  mockJobUpdate,
  mockBuildAllCoursesReport,
} = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockRawCourseFindMany: vi.fn(),
  mockRawCourseCount: vi.fn(),
  mockFilteredCourseFindMany: vi.fn(),
  mockFilteredCourseCount: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockBuildAllCoursesReport: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('./redis', () => ({ redis: {} }));
vi.mock('./auditor-export-queue', () => ({ AUDITOR_EXPORT_QUEUE_NAME: 'auditor-export' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findMany: mockFilteredCourseFindMany, count: mockFilteredCourseCount },
    organizationUser: { count: mockOrgUserCount, findMany: mockOrgUserFindMany },
    enrollment: { findMany: mockEnrollmentFindMany },
    organization: { findUnique: mockOrgFindUnique },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    job: { findUnique: mockJobFindUnique, update: mockJobUpdate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: { course: { findMany: mockRawCourseFindMany, count: mockRawCourseCount } },
}));
vi.mock('@/lib/audit-reports/report-data', () => ({
  buildCourseReport: vi.fn(),
  buildStaffReport: vi.fn(),
  buildOrgReport: vi.fn(),
  buildAllCoursesReport: mockBuildAllCoursesReport,
  buildAllStaffReport: vi.fn(),
}));

import { getExportWorker } from './auditor-export-worker';

type ExportJob = { data: Record<string, unknown>; updateProgress: (p: number) => Promise<void> };
type Processor = (job: ExportJob) => Promise<unknown>;

/** The inline processor the worker is constructed with. */
function processor(): Processor {
  delete (globalThis as unknown as { __auditorWorker?: unknown }).__auditorWorker;
  MockWorker.mockClear();
  getExportWorker();
  return (MockWorker.mock.calls[0] as unknown as [string, Processor])[1];
}

const ARCHIVED_COURSE = {
  title: 'Retired Bloodborne Pathogens',
  category: 'Compliance',
  type: 'text',
  status: 'published',
  enrollments: [{ status: 'completed' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockOrgFindUnique.mockResolvedValue({ name: 'Acme Health' });
  mockOfferingFindMany.mockResolvedValue([]);
  mockOrgUserCount.mockResolvedValue(4);
  mockOrgUserFindMany.mockResolvedValue([]);
  mockEnrollmentFindMany.mockResolvedValue([]);
  mockJobFindUnique.mockResolvedValue({ payload: {} });
  mockJobUpdate.mockResolvedValue({});
  mockBuildAllCoursesReport.mockImplementation((input: unknown) => input);
  // What a regression would read: the archive-filtered client, which returns
  // nothing for an archived course.
  mockFilteredCourseFindMany.mockResolvedValue([]);
  mockFilteredCourseCount.mockResolvedValue(0);
  mockRawCourseFindMany.mockResolvedValue([ARCHIVED_COURSE]);
  mockRawCourseCount.mockResolvedValue(1);
});

async function runScope(scope: string) {
  const run = processor()({
    data: { organizationId: 'org-1', dbJobId: 'job-1', scope, facilityIds: null },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  });
  await vi.runAllTimersAsync();
  return run;
}

describe('auditor export — archived courses stay in the report', () => {
  it('lists an archived course in the all-courses report', async () => {
    const result = (await runScope('all-courses')) as {
      summary: { totalCourses: number };
      courses: { courseTitle: string }[];
    };

    expect(mockRawCourseFindMany).toHaveBeenCalledTimes(1);
    expect(mockFilteredCourseFindMany).not.toHaveBeenCalled();
    expect(result.summary.totalCourses).toBe(1);
    expect(result.courses[0].courseTitle).toBe('Retired Bloodborne Pathogens');
  });

  it('counts an archived course in the org-scope catalogue total', async () => {
    await runScope('org');

    expect(mockRawCourseCount).toHaveBeenCalledTimes(1);
    expect(mockFilteredCourseCount).not.toHaveBeenCalled();
  });

  it('counts an archived course in the all-staff report catalogue total', async () => {
    mockOrgUserCount.mockResolvedValue(0);

    await runScope('all-staff');

    expect(mockRawCourseCount).toHaveBeenCalledTimes(1);
    expect(mockFilteredCourseCount).not.toHaveBeenCalled();
  });

  it('scopes the catalogue to the organisation by its own column, not a join through the author', async () => {
    await runScope('all-courses');

    // Q25: ownership is `Course.organizationId`. A `creator` join here would
    // return the same rows while undoing the migration onto the column.
    expect(mockRawCourseFindMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
  });
});
