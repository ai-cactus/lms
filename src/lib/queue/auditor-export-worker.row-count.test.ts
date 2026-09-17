/**
 * "Completed" must not mean two different things.
 *
 * The export writes no file anywhere: the finished job holds its result as JSON
 * and the download route serialises it on request. When the result flattens to
 * no rows the CSV is a zero-byte file — and until the job recorded a row count
 * the banner reported that outcome exactly as it reports a real report, so the
 * auditor was told the export succeeded and handed an empty file.
 *
 * The count is taken with the SAME flattener the download route uses, so the
 * number the banner acts on and the rows the file contains cannot diverge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  MockWorker,
  mockRawCourseCount,
  mockOrgUserCount,
  mockEnrollmentFindMany,
  mockOrgFindUnique,
  mockOfferingFindMany,
  mockJobFindUnique,
  mockJobUpdate,
  mockBuildOrgReport,
} = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockRawCourseCount: vi.fn(),
  mockOrgUserCount: vi.fn(),
  mockEnrollmentFindMany: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockBuildOrgReport: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('./redis', () => ({ redis: {} }));
vi.mock('./auditor-export-queue', () => ({ AUDITOR_EXPORT_QUEUE_NAME: 'auditor-export' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { count: mockOrgUserCount, findMany: vi.fn() },
    enrollment: { findMany: mockEnrollmentFindMany },
    organization: { findUnique: mockOrgFindUnique },
    orgCourseOffering: { findMany: mockOfferingFindMany },
    job: { findUnique: mockJobFindUnique, update: mockJobUpdate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({
  rawPrisma: { course: { findMany: vi.fn(), count: mockRawCourseCount } },
}));
vi.mock('@/lib/audit-reports/report-data', () => ({
  buildCourseReport: vi.fn(),
  buildStaffReport: vi.fn(),
  buildOrgReport: mockBuildOrgReport,
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

const ACTIVITY_ROW = {
  staffName: 'Dana Reed',
  courseTitle: 'Bloodborne Pathogens',
  category: 'Compliance',
  status: 'completed',
  score: 90,
  dateAssigned: '2026-01-01',
  dateCompleted: '2026-01-05',
};

/** The payload written by the final, completing `job.update`. */
function completionPayload(): Record<string, unknown> {
  const completing = mockJobUpdate.mock.calls
    .map((call) => call[0].data)
    .filter((data) => data.status === 'completed');
  return completing.at(-1)?.payload as Record<string, unknown>;
}

async function runOrgExport() {
  const run = processor()({
    data: { organizationId: 'org-1', dbJobId: 'job-1', scope: 'org', facilityIds: null },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  });
  await vi.runAllTimersAsync();
  return run;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockOrgFindUnique.mockResolvedValue({ name: 'Acme Health' });
  mockOfferingFindMany.mockResolvedValue([]);
  mockRawCourseCount.mockResolvedValue(5);
  mockOrgUserCount.mockResolvedValue(4);
  mockEnrollmentFindMany.mockResolvedValue([]);
  mockJobFindUnique.mockResolvedValue({ payload: {} });
  mockJobUpdate.mockResolvedValue({});
});

describe('auditor export — the finished job records what it can deliver', () => {
  it('records a zero row count when nothing matched the range', async () => {
    mockBuildOrgReport.mockReturnValue({ scope: 'org', activity: [] });

    await runOrgExport();

    expect(completionPayload()).toMatchObject({
      progress: 100,
      rowCount: 0,
      message: 'No records matched',
    });
  });

  it('records the row count and the ready message when the report has rows', async () => {
    mockBuildOrgReport.mockReturnValue({ scope: 'org', activity: [ACTIVITY_ROW, ACTIVITY_ROW] });

    await runOrgExport();

    expect(completionPayload()).toMatchObject({
      progress: 100,
      rowCount: 2,
      message: 'Report Ready',
    });
  });

  it('keeps the earlier payload fields the status and download routes read', async () => {
    mockJobFindUnique.mockResolvedValue({ payload: { facilityIds: ['facility-1'], scope: 'org' } });
    mockBuildOrgReport.mockReturnValue({ scope: 'org', activity: [ACTIVITY_ROW] });

    await runOrgExport();

    // The facility scope stamped at /start is what both routes re-check against.
    // Dropping it while adding rowCount would 403 every facility-bound download.
    expect(completionPayload()).toMatchObject({ facilityIds: ['facility-1'], rowCount: 1 });
  });
});
