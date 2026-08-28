/**
 * Unit tests for assignCoursesToStaffMember (src/app/actions/staff.ts) — the
 * multi-course staff-profile assignment action. Gated on `assignment.create`
 * (course-assignment rights) rather than the roster `user.edit` permission its
 * single-course predecessor `assignCourseToStaffMember` uses, so Clinical
 * Director — who assigns clinical training paths elsewhere — gains this
 * affordance while Finance and worker roles stay denied.
 *
 * Partial failure is the expected shape: already-enrolled and unassignable
 * courses are bucketed and skipped, and only the newly assigned courses reach
 * `notifyCoursesAssigned` as ONE batched notice. Nothing newly assigned ⇒ no
 * email, no notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockMembershipFindUnique,
  mockCourseFindMany,
  mockEnrollUsers,
  mockCollectDeferredNotices,
  mockNotifyCoursesAssigned,
  mockAudit,
  mockRevalidatePath,
  mockLogger,
  prismaMock,
} = vi.hoisted(() => {
  const mockMembershipFindUnique = vi.fn();
  const mockCourseFindMany = vi.fn();
  const prismaMock = {
    organizationUser: { findUnique: mockMembershipFindUnique },
    course: { findMany: mockCourseFindMany },
  };
  return {
    mockAuth: vi.fn(),
    mockMembershipFindUnique,
    mockCourseFindMany,
    mockEnrollUsers: vi.fn(),
    mockCollectDeferredNotices: vi.fn(),
    mockNotifyCoursesAssigned: vi.fn(),
    mockAudit: vi.fn(),
    mockRevalidatePath: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    prismaMock,
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/enrollment', () => ({ enrollUsers: mockEnrollUsers }));
vi.mock('@/lib/enrollment/notify', () => ({
  collectDeferredNotices: mockCollectDeferredNotices,
  notifyCoursesAssigned: mockNotifyCoursesAssigned,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { assignCoursesToStaffMember } from './staff';
// Real, unmocked module: staff.ts does an IDENTITY comparison against this
// constant to decide whether to abort the loop. Building the mocked
// refusedReason from the same import (rather than a hardcoded literal) means
// this test breaks if staff.ts's comparison ever drifts from the shared
// constant — the exact failure mode the identity check is meant to prevent.
import { BILLING_GATE_ASSIGN_MESSAGE } from '@/lib/billing';

function adminSession(role = 'owner') {
  return { user: { id: 'admin-1', email: 'admin@acme.com', role, organizationId: 'org-1' } };
}

const TARGET = { organizationId: 'org-1', user: { email: 'target@acme.com' } };
const FUTURE_DUE = '2030-01-01T00:00:00Z';
const PAST_DUE = '2020-01-01T00:00:00Z';

function enrollResult(overrides: {
  success?: string[];
  alreadyEnrolled?: string[];
  newInvited?: string[];
  failed?: string[];
  deferred?: unknown[];
  refusedReason?: string;
}) {
  return {
    success: [],
    alreadyEnrolled: [],
    newInvited: [],
    failed: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMembershipFindUnique.mockResolvedValue(TARGET);
  mockCourseFindMany.mockResolvedValue([
    { id: 'course-1', title: 'Safety Training' },
    { id: 'course-2', title: 'HIPAA Basics' },
    { id: 'course-3', title: 'Fire Safety' },
  ]);
  mockCollectDeferredNotices.mockImplementation((deferred: { userId: string }[]) =>
    deferred.length === 0 ? [] : [{ userId: deferred[0].userId, courses: deferred.map((d) => d) }],
  );
  mockNotifyCoursesAssigned.mockResolvedValue({
    emailSent: true,
    notificationCreated: true,
    courseCount: 1,
  });
});

describe('assignCoursesToStaffMember — permission gate', () => {
  it.each(['finance', 'front_desk_admin'] as const)('denies %s', async (role) => {
    mockAuth.mockResolvedValue({
      user: { id: 'admin-1', email: 'a@acme.com', role, organizationId: 'org-1' },
    });

    const result = await assignCoursesToStaffMember('staff-1', ['course-1']);

    expect(result.error).toBe('Unauthorized');
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('allows clinical_director — assignment.create legitimately grants this affordance', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'cd-1',
        email: 'cd@acme.com',
        role: 'clinical_director',
        organizationId: 'org-1',
      },
    });
    mockEnrollUsers.mockResolvedValue(enrollResult({ success: ['target@acme.com'] }));

    const result = await assignCoursesToStaffMember('staff-1', ['course-1']);

    expect(result.error).toBeUndefined();
    expect(mockEnrollUsers).toHaveBeenCalled();
  });

  it('denies when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await assignCoursesToStaffMember('staff-1', ['course-1']);

    expect(result.error).toBe('Unauthorized');
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });
});

describe('assignCoursesToStaffMember — input validation before any DB call', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(adminSession());
  });

  it('rejects an empty course list', async () => {
    const result = await assignCoursesToStaffMember('staff-1', []);

    expect(result.error).toBe('Select at least one course to assign.');
    expect(mockMembershipFindUnique).not.toHaveBeenCalled();
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('rejects more than the 50-course cap', async () => {
    const courseIds = Array.from({ length: 51 }, (_, i) => `course-${i}`);

    const result = await assignCoursesToStaffMember('staff-1', courseIds);

    expect(result.error).toBe('You can assign at most 50 courses at a time.');
    expect(mockMembershipFindUnique).not.toHaveBeenCalled();
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('rejects a deadline that is not in the future', async () => {
    const result = await assignCoursesToStaffMember('staff-1', ['course-1'], { dueAt: PAST_DUE });

    expect(result.error).toBe('The deadline must be in the future.');
    expect(mockMembershipFindUnique).not.toHaveBeenCalled();
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('rejects an unparseable deadline', async () => {
    const result = await assignCoursesToStaffMember('staff-1', ['course-1'], {
      dueAt: 'not-a-date',
    });

    expect(result.error).toBe('The deadline is not a valid date.');
    expect(mockMembershipFindUnique).not.toHaveBeenCalled();
  });

  it('dedups repeated course ids before calling enrollUsers', async () => {
    mockEnrollUsers.mockResolvedValue(enrollResult({ success: ['target@acme.com'] }));

    await assignCoursesToStaffMember('staff-1', ['course-1', 'course-1', 'course-2']);

    expect(mockEnrollUsers).toHaveBeenCalledTimes(2);
  });
});

describe('assignCoursesToStaffMember — tenancy', () => {
  it('rejects a target in a different organization with Forbidden, calling enrollUsers zero times', async () => {
    mockAuth.mockResolvedValue(adminSession());
    mockMembershipFindUnique.mockResolvedValue({
      organizationId: 'org-OTHER',
      user: { email: 'x@other.com' },
    });

    const result = await assignCoursesToStaffMember('staff-1', ['course-1']);

    expect(result.error).toBe('Forbidden');
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent staff user with Forbidden', async () => {
    mockAuth.mockResolvedValue(adminSession());
    mockMembershipFindUnique.mockResolvedValue(null);

    const result = await assignCoursesToStaffMember('staff-1', ['course-1']);

    expect(result.error).toBe('Forbidden');
    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });
});

describe('assignCoursesToStaffMember — per-course outcomes and the batched notice', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(adminSession());
  });

  it('2 newly assigned + 1 already-enrolled: notifyCoursesAssigned is called ONCE, and the result buckets only the 2 titles as assigned', async () => {
    mockEnrollUsers
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-1', courseTitle: 'Safety Training' }],
        }),
      )
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-2', courseTitle: 'HIPAA Basics' }],
        }),
      )
      .mockResolvedValueOnce(enrollResult({ alreadyEnrolled: ['target@acme.com'] }));

    const result = await assignCoursesToStaffMember('staff-1', [
      'course-1',
      'course-2',
      'course-3',
    ]);

    expect(result.assigned).toEqual([
      { courseId: 'course-1', courseTitle: 'Safety Training' },
      { courseId: 'course-2', courseTitle: 'HIPAA Basics' },
    ]);
    expect(result.alreadyAssigned).toEqual([{ courseId: 'course-3', courseTitle: 'Fire Safety' }]);
    expect(mockNotifyCoursesAssigned).toHaveBeenCalledTimes(1);
    expect(result.emailSent).toBe(true);
  });

  it('all courses already-enrolled: notifyCoursesAssigned is never called and emailSent is false', async () => {
    mockEnrollUsers.mockResolvedValue(enrollResult({ alreadyEnrolled: ['target@acme.com'] }));

    const result = await assignCoursesToStaffMember('staff-1', ['course-1', 'course-2']);

    expect(result.assigned).toEqual([]);
    expect(mockNotifyCoursesAssigned).not.toHaveBeenCalled();
    expect(result.emailSent).toBe(false);
  });

  it('an unknown course id is bucketed to failed with a null title, without calling enrollUsers for it', async () => {
    mockCourseFindMany.mockResolvedValue([{ id: 'course-1', title: 'Safety Training' }]);
    mockEnrollUsers.mockResolvedValue(enrollResult({ success: ['target@acme.com'] }));

    const result = await assignCoursesToStaffMember('staff-1', ['course-1', 'ghost-course']);

    expect(result.failed).toEqual([{ courseId: 'ghost-course', courseTitle: null }]);
    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
  });

  // enrollUsers now RETURNS the billing refusal (it survives production error
  // redaction that way), so the loop must abort on the returned reason — the
  // gate is organization-wide, not course-specific.
  it('a billing-gate refusal aborts the loop — later courses are never attempted', async () => {
    mockEnrollUsers
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-1', courseTitle: 'Safety Training' }],
        }),
      )
      .mockResolvedValueOnce(
        enrollResult({
          refusedReason: BILLING_GATE_ASSIGN_MESSAGE,
        }),
      );

    const result = await assignCoursesToStaffMember('staff-1', [
      'course-1',
      'course-2',
      'course-3',
    ]);

    expect(mockEnrollUsers).toHaveBeenCalledTimes(2);
    expect(result.error).toBe(BILLING_GATE_ASSIGN_MESSAGE);
    expect(result.assigned).toEqual([{ courseId: 'course-1', courseTitle: 'Safety Training' }]);
  });

  // A refusedReason that merely resembles the billing message but is not the
  // SAME string (a divergent copy) must NOT trip the identity-compared abort —
  // it is course-specific like any other refusal and the loop continues.
  it('does not abort on a refusedReason that only resembles the billing message', async () => {
    mockEnrollUsers
      .mockResolvedValueOnce(
        enrollResult({ refusedReason: 'Your organization needs an active subscription.' }),
      )
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-2', courseTitle: 'HIPAA Basics' }],
        }),
      );

    const result = await assignCoursesToStaffMember('staff-1', ['course-1', 'course-2']);

    expect(mockEnrollUsers).toHaveBeenCalledTimes(2);
    expect(result.error).toBeUndefined();
    expect(result.failed).toEqual([{ courseId: 'course-1', courseTitle: 'Safety Training' }]);
    expect(result.assigned).toEqual([{ courseId: 'course-2', courseTitle: 'HIPAA Basics' }]);
  });

  it('a generic throw on course 2 of 3 buckets only that course to failed and continues to course 3', async () => {
    mockEnrollUsers
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-1', courseTitle: 'Safety Training' }],
        }),
      )
      .mockRejectedValueOnce(new Error('unexpected failure'))
      .mockResolvedValueOnce(
        enrollResult({
          success: ['target@acme.com'],
          deferred: [{ userId: 'user-1', courseId: 'course-3', courseTitle: 'Fire Safety' }],
        }),
      );

    const result = await assignCoursesToStaffMember('staff-1', [
      'course-1',
      'course-2',
      'course-3',
    ]);

    expect(mockEnrollUsers).toHaveBeenCalledTimes(3);
    expect(result.failed).toEqual([{ courseId: 'course-2', courseTitle: 'HIPAA Basics' }]);
    expect(result.assigned).toEqual([
      { courseId: 'course-1', courseTitle: 'Safety Training' },
      { courseId: 'course-3', courseTitle: 'Fire Safety' },
    ]);
  });

  it('calls enrollUsers with a future dueAt and preserve settings mode', async () => {
    mockEnrollUsers.mockResolvedValue(enrollResult({ success: ['target@acme.com'] }));

    await assignCoursesToStaffMember('staff-1', ['course-1'], { dueAt: FUTURE_DUE });

    expect(mockEnrollUsers).toHaveBeenCalledWith(
      'course-1',
      [{ email: 'target@acme.com' }],
      { dueAt: new Date(FUTURE_DUE) },
      { deferWorkerNotification: true, assignmentSettingsMode: 'preserve' },
    );
  });
});

describe('assignCoursesToStaffMember — no raw email in any log call', () => {
  it('never logs the target email address in cleartext', async () => {
    mockAuth.mockResolvedValue(adminSession());
    mockEnrollUsers.mockResolvedValue(
      enrollResult({
        success: ['target@acme.com'],
        deferred: [{ userId: 'user-1', courseId: 'course-1', courseTitle: 'Safety Training' }],
      }),
    );

    await assignCoursesToStaffMember('staff-1', ['course-1']);

    for (const level of ['info', 'warn', 'error'] as const) {
      for (const call of mockLogger[level].mock.calls) {
        expect(JSON.stringify(call)).not.toContain('target@acme.com');
      }
    }
  });
});
