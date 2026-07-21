/**
 * Regression guard for the wizard deadline-drop bug (Issue #2 / TC-015):
 * `createFullCourse` used to write enrollments via a bespoke duplicated block
 * that never set `dueAt` and never created a `CourseAssignment`, silently
 * disabling the entire reminder/escalation ladder for wizard-assigned workers.
 * It now delegates to the shared `enrollUsers` (tested independently in
 * enrollment.test.ts) — this suite only proves the delegation wiring itself:
 * the right staff list and the right `dueAt` (from `combineDateAndTime`) reach
 * `enrollUsers`, and course creation never throws if `enrollUsers` does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, mockUserFindUnique, mockCourseCreate, mockEnrollUsers } =
  vi.hoisted(() => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockCourseCreate: vi.fn(),
    mockEnrollUsers: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { findUnique: mockUserFindUnique },
    course: { create: mockCourseCreate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('./enrollment', () => ({ enrollUsers: mockEnrollUsers }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createFullCourse } from './course';

const BASE_COURSE_INPUT = {
  title: 'Infection Control',
  description: 'desc',
  difficulty: 'beginner',
  duration: '30',
  modules: [{ title: 'Module 1', content: 'content', duration: '10 min' }],
  quiz: [],
  assignments: ['alice@example.com', 'bob@example.com'],
};

describe('createFullCourse — assignment delegation to enrollUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue({ user: { id: 'admin-1' } });
    mockWorkerAuth.mockResolvedValue(null);
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    mockCourseCreate.mockResolvedValue({ id: 'course-1' });
    mockEnrollUsers.mockResolvedValue({
      success: [],
      alreadyEnrolled: [],
      newInvited: [],
      failed: [],
    });
  });

  it('calls enrollUsers with the wizard staff list and a dueAt combined from dueDate + dueTime', async () => {
    const dueDate = new Date('2026-09-01T00:00:00Z');

    await createFullCourse({ ...BASE_COURSE_INPUT, dueDate, dueTime: '5:00 PM' });

    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
    const [courseId, staffEntries, assignmentSettings] = mockEnrollUsers.mock.calls[0];
    expect(courseId).toBe('course-1');
    expect(staffEntries).toEqual([{ email: 'alice@example.com' }, { email: 'bob@example.com' }]);
    expect(assignmentSettings?.dueAt?.toISOString()).toBe('2026-09-01T17:00:00.000Z');
  });

  it('passes a null dueAt through to enrollUsers when no dueDate is set (falls back to enrollUsers window default)', async () => {
    await createFullCourse({ ...BASE_COURSE_INPUT, dueTime: '5:00 PM' });

    expect(mockEnrollUsers).toHaveBeenCalledTimes(1);
    const [, , assignmentSettings] = mockEnrollUsers.mock.calls[0];
    expect(assignmentSettings?.dueAt).toBeNull();
  });

  it('does not call enrollUsers when the wizard has no assignments', async () => {
    await createFullCourse({ ...BASE_COURSE_INPUT, assignments: [] });

    expect(mockEnrollUsers).not.toHaveBeenCalled();
  });

  it('reports enrollUsers outcomes back on the createFullCourse result', async () => {
    mockEnrollUsers.mockResolvedValue({
      success: ['alice@example.com'],
      alreadyEnrolled: [],
      newInvited: ['bob@example.com'],
      failed: [],
    });

    const result = await createFullCourse({
      ...BASE_COURSE_INPUT,
      dueDate: new Date('2026-09-01T00:00:00Z'),
    });

    expect(result.inviteResults).toEqual({
      existingEnrolled: 1,
      newInvited: 1,
      failed: [],
      skipped: [],
    });
  });

  it('never fails course creation when enrollUsers throws (assignment errors are non-fatal)', async () => {
    mockEnrollUsers.mockRejectedValue(
      new Error('Your organization needs an active subscription to assign courses.'),
    );

    const result = await createFullCourse({
      ...BASE_COURSE_INPUT,
      dueDate: new Date('2026-09-01T00:00:00Z'),
    });

    expect(result.success).toBe(true);
    expect(result.courseId).toBe('course-1');
    expect(result.inviteResults).toEqual({
      existingEnrolled: 0,
      newInvited: 0,
      failed: [],
      skipped: [],
    });
  });
});
