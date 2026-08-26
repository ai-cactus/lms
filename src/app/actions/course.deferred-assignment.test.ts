/**
 * Regression suite for Issue #14 — the F-051 quality gate must hold BOTH
 * enrollment and the launch email until an admin explicitly acknowledges the
 * gate's warnings.
 *
 * Root cause: `createFullCourse` used to call `enrollUsers` (and the wizard
 * called `assignCourseToRoles`) unconditionally, even when the course it just
 * created was flagged `reviewRequired` and saved as a draft — so a learner
 * could be enrolled, put on a reminder ladder, and emailed about a course an
 * admin had not yet reviewed. The fix defers the intent onto
 * `Course.pendingAssignment` (see pending-assignment.test.ts for the
 * build/parse round-trip) and replays it from `publishCourse` only once
 * `acknowledgeWarnings: true` is passed AND the gate was actually open.
 *
 * `enrollUsers`/`assignCourseToRoles` are mocked as opaque black boxes here —
 * they are the ONLY code paths that create enrollments or send the launch
 * email (enrollment.test.ts covers their own internals), so "was
 * enrollUsers/assignCourseToRoles called" is the correct proxy for "was
 * anyone enrolled or emailed" at this layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@/generated/prisma/client';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseCreate,
  mockCourseFindUnique,
  mockCourseUpdate,
  mockEnrollUsers,
  mockAssignCourseToRoles,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseCreate: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockCourseUpdate: vi.fn(),
  mockEnrollUsers: vi.fn(),
  mockAssignCourseToRoles: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: {
      create: mockCourseCreate,
      findUnique: mockCourseFindUnique,
      update: mockCourseUpdate,
    },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./enrollment', () => ({
  enrollUsers: mockEnrollUsers,
  assignCourseToRoles: mockAssignCourseToRoles,
}));

import { createFullCourse, publishCourse } from './course';

/**
 * `publishCourse` returns a union — the review-gate refusal, or the published
 * course. These tests only ever assert on the published branch, so narrow once
 * here rather than repeating the guard at every call site.
 */
function published<T extends object>(result: T): Extract<T, { assignmentFailed: boolean }> {
  if (!('assignmentFailed' in result)) {
    throw new Error(`publishCourse refused to publish: ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { assignmentFailed: boolean }>;
}

const ORG_USER_ID = 'ou-admin-1';
const COURSE_ID = 'course-1';

const emptyEnrollResult = { success: [], alreadyEnrolled: [], newInvited: [], failed: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: {
      id: 'admin-1',
      role: 'owner',
      organizationUserId: ORG_USER_ID,
      organizationId: 'org-1',
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollUsers.mockResolvedValue(emptyEnrollResult);
  mockAssignCourseToRoles.mockResolvedValue({ success: [], failed: [], targetRoles: [] });
});

/** Deliberately degraded v4.6 artifacts: no slides ⇒ reviewRequired = true. */
function degradedCourseData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Degraded Course',
    description: 'desc',
    difficulty: 'moderate',
    duration: '30',
    modules: [{ title: 'M1', content: 'c', duration: '10 min' }],
    quiz: [{ question: 'Q0', options: ['a', 'b'], answer: 0 }],
    assignments: [] as string[],
    rawArticleMeta: { meta: { status: 'ok' } },
    rawSlidesJson: { slides: [] }, // triggers "No slides were generated"
    ...overrides,
  };
}

function healthyCourseData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Healthy Course',
    description: 'desc',
    difficulty: 'moderate',
    duration: '30',
    modules: [{ title: 'M1', content: 'c', duration: '10 min' }],
    quiz: [{ question: 'Q0', options: ['a', 'b'], answer: 0 }],
    assignments: [] as string[],
    rawArticleMeta: { meta: { status: 'ok' } },
    rawSlidesJson: { slides: [{ slideId: 's1' }] },
    ...overrides,
  };
}

describe('createFullCourse — deferring assignment behind the F-051 gate', () => {
  it('holds a review-required course with email assignments: enrollUsers is never called, and the intent is parked as pendingAssignment', async () => {
    mockCourseCreate.mockResolvedValue({ id: COURSE_ID });

    const result = await createFullCourse(
      degradedCourseData({ assignments: ['alice@example.com', 'bob@example.com'] }),
    );

    expect(result.reviewRequired).toBe(true);

    // Core regression guard: no enrollment AND no email. enrollUsers is the
    // only code path that creates an enrollment row or sends the launch
    // email, so asserting it was never invoked proves neither happened.
    expect(mockEnrollUsers).not.toHaveBeenCalled();

    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.status).toBe('draft');
    expect(createArgs.data.pendingAssignment).toEqual({
      mode: 'email',
      emails: ['alice@example.com', 'bob@example.com'],
      dueAt: null,
    });
  });

  it('holds a review-required course with a role assignment: pendingAssignment is written in roles shape, and no assignment call fires', async () => {
    mockCourseCreate.mockResolvedValue({ id: COURSE_ID });

    const result = await createFullCourse(
      degradedCourseData({
        assignments: [],
        roleAssignment: {
          roles: ['nurse', 'hr'],
          dueWindowDays: 14,
          remindersEnabled: true,
          reminderDaysBefore: [7, 1],
          renewalCycle: 'annual',
        },
      }),
    );

    expect(result.reviewRequired).toBe(true);
    expect(mockEnrollUsers).not.toHaveBeenCalled();
    // assignCourseToRoles is a publishCourse-replay concern only — createFullCourse
    // itself must never call it, gated or not.
    expect(mockAssignCourseToRoles).not.toHaveBeenCalled();

    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.pendingAssignment).toMatchObject({
      mode: 'roles',
      roles: ['nurse', 'hr'],
      dueWindowDays: 14,
      remindersEnabled: true,
      reminderDaysBefore: [7, 1],
      renewalCycle: 'annual',
    });
  });

  it('a healthy course with email assignments still calls enrollUsers exactly as before (byte-identity regression guard)', async () => {
    mockCourseCreate.mockResolvedValue({ id: COURSE_ID });

    const result = await createFullCourse(
      healthyCourseData({
        assignments: ['alice@example.com', 'bob@example.com'],
        dueDate: new Date('2026-09-01T00:00:00Z'),
        dueTime: '5:00 PM',
      }),
    );

    expect(result.reviewRequired).toBe(false);
    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
    const [courseId, staffEntries, assignmentSettings] = mockEnrollUsers.mock.calls[0];
    expect(courseId).toBe(COURSE_ID);
    expect(staffEntries).toEqual([{ email: 'alice@example.com' }, { email: 'bob@example.com' }]);
    expect(assignmentSettings?.dueAt?.toISOString()).toBe('2026-09-01T17:00:00.000Z');

    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.pendingAssignment).toBeUndefined();
  });

  it('a healthy course with no assignments never calls enrollUsers and writes no pendingAssignment', async () => {
    mockCourseCreate.mockResolvedValue({ id: COURSE_ID });

    await createFullCourse(healthyCourseData({ assignments: [] }));

    expect(mockEnrollUsers).not.toHaveBeenCalled();
    const createArgs = mockCourseCreate.mock.calls[0][0];
    expect(createArgs.data.pendingAssignment).toBeUndefined();
  });
});

describe('publishCourse — replaying the deferred assignment on acknowledgement', () => {
  const emailPending = { mode: 'email' as const, emails: ['alice@example.com'], dueAt: null };
  const rolesPending = {
    mode: 'roles' as const,
    roles: ['nurse'],
    dueDate: '2026-09-01T00:00:00.000Z',
    dueTime: '9:00 AM',
    dueWindowDays: 14,
    remindersEnabled: true,
    reminderDaysBefore: [7],
    renewalCycle: 'annual' as const,
  };

  function heldCourse(pendingAssignment: unknown) {
    return {
      id: COURSE_ID,
      createdByOrgUserId: ORG_USER_ID,
      reviewRequired: true,
      qualityWarnings: ['No slides were generated for this course.'],
      pendingAssignment,
    };
  }

  it('replays an email-mode pendingAssignment through enrollUsers and clears the column in the same update', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse(emailPending));
    mockCourseUpdate.mockResolvedValue({ id: COURSE_ID, status: 'published' });

    const result = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
    const [courseId, staffEntries, assignmentSettings] = mockEnrollUsers.mock.calls[0];
    expect(courseId).toBe(COURSE_ID);
    expect(staffEntries).toEqual([{ email: 'alice@example.com' }]);
    expect(assignmentSettings?.dueAt).toBeNull();

    const updateArgs = mockCourseUpdate.mock.calls[0][0];
    expect(updateArgs.data.status).toBe('published');
    expect(updateArgs.data.pendingAssignment).toBe(Prisma.DbNull);
    expect(published(result).assignmentFailed).toBe(false);
  });

  it('replays a roles-mode pendingAssignment through assignCourseToRoles', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse(rolesPending));
    mockCourseUpdate.mockResolvedValue({ id: COURSE_ID, status: 'published' });

    const result = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1);
    expect(mockEnrollUsers).not.toHaveBeenCalled();
    const [courseId, roles, settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(courseId).toBe(COURSE_ID);
    expect(roles).toEqual(['nurse']);
    expect(settings).toMatchObject({
      dueDate: '2026-09-01T00:00:00.000Z',
      dueTime: '9:00 AM',
      dueWindowDays: 14,
      remindersEnabled: true,
      reminderDaysBefore: [7],
      renewalCycle: 'annual',
    });
    expect(published(result).assignmentFailed).toBe(false);
  });

  it('never replays when reviewRequired is true but acknowledgeWarnings is not set (blocked before any write)', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse(emailPending));

    await publishCourse(COURSE_ID);

    expect(mockEnrollUsers).not.toHaveBeenCalled();
    expect(mockAssignCourseToRoles).not.toHaveBeenCalled();
    expect(mockCourseUpdate).not.toHaveBeenCalled();
  });

  it('retry idempotency: publishing the same acknowledged draft a second time (after the column was actually cleared) is a genuine no-op — no second email/enrollment', async () => {
    // First publish: gate open, pendingAssignment present.
    mockCourseFindUnique.mockResolvedValueOnce(heldCourse(emailPending));
    mockCourseUpdate.mockResolvedValueOnce({ id: COURSE_ID, status: 'published' });
    await publishCourse(COURSE_ID, { acknowledgeWarnings: true });
    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);

    // Second publish reads the now-cleared row: reviewRequired flipped false,
    // pendingAssignment cleared — exactly what the first update actually wrote.
    mockCourseFindUnique.mockResolvedValueOnce({
      id: COURSE_ID,
      createdByOrgUserId: ORG_USER_ID,
      reviewRequired: false,
      qualityWarnings: [],
      pendingAssignment: null,
    });
    mockCourseUpdate.mockResolvedValueOnce({ id: COURSE_ID, status: 'published' });

    await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    // Still exactly one call total — the retry fired no second enrollment/email.
    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
    expect(mockAssignCourseToRoles).not.toHaveBeenCalled();
  });

  it('concurrent-retry race: if two publishCourse calls both read the pre-clear snapshot, the SECOND call still relies on — and must surface — enrollUsers own alreadyEnrolled dedup rather than silently double-enrolling', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse(emailPending));
    mockCourseUpdate.mockResolvedValue({ id: COURSE_ID, status: 'published' });

    // First call lands normally.
    mockEnrollUsers.mockResolvedValueOnce({
      success: ['alice@example.com'],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
    });
    const first = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });
    expect(published(first).assignmentFailed).toBe(false);

    // Second call races in on the same stale snapshot (mockCourseFindUnique
    // above was never advanced to the cleared state). course.ts itself does
    // not dedupe this — enrollUsers is called again — but its OWN dedup must
    // report the member as already enrolled, not send a second launch email.
    mockEnrollUsers.mockResolvedValueOnce({
      success: [],
      alreadyEnrolled: ['alice@example.com'],
      newInvited: [],
      failed: [],
    });
    const second = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    expect(mockEnrollUsers).toHaveBeenCalledTimes(2);
    // The regression guard is the RETURNED outcome of the second replay, not
    // merely that publishCourse didn't throw.
    await expect(mockEnrollUsers.mock.results[1].value).resolves.toMatchObject({
      success: [],
      alreadyEnrolled: ['alice@example.com'],
    });
    expect(published(second).assignmentFailed).toBe(false);
  });

  it('a replay failure (e.g. the billing gate rejecting enrollUsers) never fails the publish — assignmentFailed is reported instead of throwing', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse(emailPending));
    mockCourseUpdate.mockResolvedValue({ id: COURSE_ID, status: 'published' });
    mockEnrollUsers.mockRejectedValue(
      new Error('Your organization needs an active subscription to assign courses.'),
    );

    const result = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    expect(mockCourseUpdate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: COURSE_ID, status: 'published', assignmentFailed: true });
  });

  it('a malformed pendingAssignment blob is treated as a failed replay (assignmentFailed: true), never thrown, and the course still publishes', async () => {
    mockCourseFindUnique.mockResolvedValue(heldCourse({ mode: 'unknown-legacy-shape' }));
    mockCourseUpdate.mockResolvedValue({ id: COURSE_ID, status: 'published' });

    const result = await publishCourse(COURSE_ID, { acknowledgeWarnings: true });

    expect(mockEnrollUsers).not.toHaveBeenCalled();
    expect(mockAssignCourseToRoles).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'published', assignmentFailed: true });
  });
});
