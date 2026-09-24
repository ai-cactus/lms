/**
 * The all-staff export's "Last Activity" must mean the same thing as the
 * Auditor roster's.
 *
 * Both read `Enrollment.completedAt` over a list ordered by START date, so the
 * FIRST row carrying a completion is whichever completed enrollment was started
 * most recently — not the most recent completion. The on-screen roster
 * (`getAuditorStaffRows`) already took the maximum; the export took the first
 * match, and the two could only be caught disagreeing once BUG-08 made
 * `completedAt` non-null at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  MockWorker,
  mockRawCourseCount,
  mockOrgUserFindMany,
  mockOrgFindUnique,
  mockOfferingFindMany,
  mockJobFindUnique,
  mockJobUpdate,
  mockBuildAllStaffReport,
} = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockRawCourseCount: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockOfferingFindMany: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockBuildAllStaffReport: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('./redis', () => ({ redis: {} }));
vi.mock('./auditor-export-queue', () => ({ AUDITOR_EXPORT_QUEUE_NAME: 'auditor-export' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { count: vi.fn(), findMany: mockOrgUserFindMany },
    enrollment: { findMany: vi.fn() },
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
  buildOrgReport: vi.fn(),
  buildAllCoursesReport: vi.fn(),
  buildAllStaffReport: mockBuildAllStaffReport,
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

async function runAllStaffExport() {
  const run = processor()({
    data: { organizationId: 'org-1', dbJobId: 'job-1', scope: 'all-staff', facilityIds: null },
    updateProgress: vi.fn().mockResolvedValue(undefined),
  });
  await vi.runAllTimersAsync();
  return run;
}

/** The single staff row handed to the report builder. */
function staffRow(): Record<string, unknown> {
  const input = mockBuildAllStaffReport.mock.calls[0]?.[0] as
    { staff: Record<string, unknown>[] } | undefined;
  if (!input) throw new Error('buildAllStaffReport was never called');
  return input.staff[0];
}

const NEWER_COMPLETION = new Date('2026-06-18T10:00:00.000Z');
const OLDER_COMPLETION = new Date('2026-02-01T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockOrgFindUnique.mockResolvedValue({ name: 'Acme Health' });
  mockOfferingFindMany.mockResolvedValue([]);
  mockRawCourseCount.mockResolvedValue(5);
  mockJobFindUnique.mockResolvedValue({ payload: {} });
  mockJobUpdate.mockResolvedValue({});
  mockBuildAllStaffReport.mockReturnValue({ scope: 'all-staff', staff: [] });
});

describe('all-staff export — Last Activity', () => {
  it('reports the LATEST completion, not the first one in start-date order', async () => {
    // Ordered by `startedAt: 'desc'`: the most recently started enrollment is
    // still running, the next one completed in February, and an older
    // enrollment completed in June. Taking the first non-null would report
    // February.
    mockOrgUserFindMany.mockResolvedValue([
      {
        role: 'worker_nurse',
        user: { fullName: 'Dana Reed', email: 'dana@example.com' },
        enrollments: [
          { status: 'in_progress', completedAt: null },
          { status: 'attested', completedAt: OLDER_COMPLETION },
          { status: 'attested', completedAt: NEWER_COMPLETION },
        ],
      },
    ]);

    await runAllStaffExport();

    expect(staffRow().lastActivity).toEqual(NEWER_COMPLETION);
  });

  it('reports null when the member has no completion at all', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      {
        role: 'worker_nurse',
        user: { fullName: 'Dana Reed', email: 'dana@example.com' },
        enrollments: [{ status: 'in_progress', completedAt: null }],
      },
    ]);

    await runAllStaffExport();

    expect(staffRow().lastActivity).toBeNull();
  });

  it('counts terminal statuses as completed regardless of which one carries the date', async () => {
    mockOrgUserFindMany.mockResolvedValue([
      {
        role: 'worker_nurse',
        user: { fullName: 'Dana Reed', email: 'dana@example.com' },
        enrollments: [
          { status: 'completed', completedAt: OLDER_COMPLETION },
          { status: 'attested', completedAt: NEWER_COMPLETION },
          { status: 'locked', completedAt: null },
        ],
      },
    ]);

    await runAllStaffExport();

    expect(staffRow()).toMatchObject({ coursesAssigned: 3, coursesCompleted: 2 });
  });
});
