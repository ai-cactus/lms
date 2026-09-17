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
 *
 * The maintainer has since ruled that no learner may be enrolled in a draft, so
 * the return value is now load-bearing: `true` means "in service, go ahead",
 * `false` means the caller must refuse. These tests pin both halves.
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
    await expect(publishCourseOnAssignment(draft, 'user-1', 'ou-1')).resolves.toBe(true);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      // D9: the assigner is recorded as the reviewer, so this path no longer
      // publishes a course attributed to nobody.
      data: {
        status: 'published',
        approvedByOrgUserId: 'ou-1',
        approvedAt: expect.any(Date),
      },
    });
  });

  it('is a no-op for an already-published course, so re-assigning writes nothing', async () => {
    await expect(
      publishCourseOnAssignment({ ...draft, status: 'published' }, 'user-1', 'ou-1'),
    ).resolves.toBe(true);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('never touches a global catalogue course — its lifecycle belongs to another tenant', async () => {
    // A global DRAFT is not ours to publish, so the caller is told to refuse
    // rather than being left to enrol into it.
    await expect(
      publishCourseOnAssignment({ ...draft, isGlobal: true }, 'user-1', 'ou-1'),
    ).resolves.toBe(false);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('never publishes a course held for quality review', async () => {
    // Assignment is blocked upstream for these; only the quality gate may clear
    // the hold, so this must not relabel one behind its back — and must not let
    // the caller enrol into it either.
    await expect(
      publishCourseOnAssignment({ ...draft, reviewRequired: true }, 'user-1', 'ou-1'),
    ).resolves.toBe(false);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('leaves an inactive (retired) course alone rather than reviving it', async () => {
    // Retirement is a deliberate act. Only `draft` — the "creation never
    // finished" state this fix is about — moves, and a retired course stays
    // assignable, so this reports in-service.
    await expect(
      publishCourseOnAssignment({ ...draft, status: 'inactive' }, 'user-1', 'ou-1'),
    ).resolves.toBe(true);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports NOT in service when the status write fails, so the caller refuses', async () => {
    mockUpdate.mockRejectedValue(new Error('db down'));

    // Reverses the old "never fail the assignment" behaviour: a course that
    // could not leave draft must not gain enrollments. The failure is still
    // logged rather than thrown — the caller returns a refusal, which survives
    // production error redaction where a thrown message would not.
    await expect(publishCourseOnAssignment(draft, 'user-1', 'ou-1')).resolves.toBe(false);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('tolerates a null org-user id — publishes but records no reviewer', async () => {
    // D10's permanent case: a caller with no OrganizationUser id (should not
    // occur in practice, but the parameter type allows it) must still get the
    // status flip; the hero's fallback-to-creator copy handles the null.
    await expect(publishCourseOnAssignment(draft, 'user-1', null)).resolves.toBe(true);

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        status: 'published',
        approvedByOrgUserId: null,
        approvedAt: expect.any(Date),
      },
    });
  });

  it('logs the transition, so a silent skip cannot hide again', async () => {
    await publishCourseOnAssignment(draft, 'user-1', 'ou-1');

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'c1', userId: 'user-1' }),
    );
  });
});
