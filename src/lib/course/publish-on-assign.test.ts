/**
 * "A published, takeable course shows Draft in audit reports."
 *
 * The report was correct. `status` was simply never enforced on the assign path:
 * enrollUsers and assignCourseToRoleTargets gate on `reviewRequired`, so an
 * ordinary unheld draft stays assignable — and forks start as
 * `draft` + `reviewRequired: false`. Duplicating a course and assigning it from
 * a staff profile therefore produced a course learners completed and earned
 * certificates for while the record still said Draft. Only the /assign page
 * published, and only for itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdate, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { course: { update: mockUpdate } };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: mockLoggerInfo, warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { publishCourseOnAssignment } from './publish-on-assign';

const draft = { id: 'c1', status: 'draft', isGlobal: false, reviewRequired: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe('publishCourseOnAssignment', () => {
  it('publishes an unheld draft — the reported case', async () => {
    await publishCourseOnAssignment(draft, 'user-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'published' },
    });
  });

  it('is a no-op for an already-published course, so re-assigning writes nothing', async () => {
    await publishCourseOnAssignment({ ...draft, status: 'published' }, 'user-1');

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('never touches a global catalogue course — its lifecycle belongs to another tenant', async () => {
    await publishCourseOnAssignment({ ...draft, isGlobal: true }, 'user-1');

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('never publishes a course held for quality review', async () => {
    // Assignment is blocked upstream for these; only the quality gate may clear
    // the hold, so this must not relabel one behind its back.
    await publishCourseOnAssignment({ ...draft, reviewRequired: true }, 'user-1');

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('leaves an inactive (retired) course alone rather than reviving it', async () => {
    await publishCourseOnAssignment({ ...draft, status: 'inactive' }, 'user-1');

    // Retirement is a deliberate act. Only `draft` — the "creation never
    // finished" state this fix is about — moves.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not fail the assignment when the status write fails', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'));

    // The assignment is already authorised; losing the relabel must not undo it.
    await expect(publishCourseOnAssignment(draft, 'user-1')).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('logs the transition, so a silent skip cannot hide again', async () => {
    await publishCourseOnAssignment(draft, 'user-1');

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', userId: 'user-1' }),
    );
  });
});
