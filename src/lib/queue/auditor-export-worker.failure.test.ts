/**
 * RISK-19: a failed export must keep the payload it was created with.
 *
 * The failure write used to REPLACE the payload, dropping `organizationId` (the
 * stamp the permanent org delete finds the row by, and status/download refuse
 * other organizations by) and `facilityIds` (the scope a facility-bound caller
 * is judged against).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MockWorker, mockJobFindUnique, mockJobUpdate, mockLoggerError } = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('./redis', () => ({ redis: {} }));
vi.mock('./auditor-export-queue', () => ({ AUDITOR_EXPORT_QUEUE_NAME: 'auditor-export' }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
}));
vi.mock('@/lib/prisma', () => {
  const prisma = { job: { findUnique: mockJobFindUnique, update: mockJobUpdate } };
  return { prisma, default: prisma };
});
vi.mock('@/db/index', () => ({ rawPrisma: {} }));

import { getExportWorker } from './auditor-export-worker';

type FailedHandler = (
  job: { id: string; data: Record<string, unknown> },
  err: Error,
) => Promise<void>;

function failedHandler(): FailedHandler {
  delete (globalThis as unknown as { __auditorWorker?: unknown }).__auditorWorker;
  MockWorker.mockClear();
  const worker = getExportWorker() as unknown as { on: ReturnType<typeof vi.fn> };
  const registration = worker.on.mock.calls.find(([event]) => event === 'failed');
  return registration?.[1] as FailedHandler;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJobUpdate.mockResolvedValue({});
});

describe('auditor export worker — failure path', () => {
  it('merges the failure into the existing payload, keeping organizationId and facilityIds', async () => {
    mockJobFindUnique.mockResolvedValue({
      payload: {
        organizationId: 'org-1',
        facilityIds: ['facility-1'],
        scope: 'org',
        progress: 40,
        message: 'Querying enrollments...',
      },
    });

    await failedHandler()({ id: 'bull-1', data: { dbJobId: 'job-1' } }, new Error('boom'));

    expect(mockJobUpdate).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'failed',
        payload: {
          organizationId: 'org-1',
          facilityIds: ['facility-1'],
          scope: 'org',
          progress: 0,
          message: 'Export failed due to server error',
        },
      },
    });
  });

  it('logs, rather than rejects, when the failure itself cannot be recorded', async () => {
    mockJobFindUnique.mockResolvedValue({ payload: { organizationId: 'org-1' } });
    mockJobUpdate.mockRejectedValue(new Error('row gone'));

    await expect(
      failedHandler()({ id: 'bull-1', data: { dbJobId: 'job-1' } }, new Error('boom')),
    ).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[auditor] Failed to record export job failure',
        jobId: 'job-1',
      }),
    );
  });
});
