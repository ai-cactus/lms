/**
 * Deleting a course reported "Minified React error #441".
 *
 * Two defects, one visible:
 *
 *  1. Every refusal was THROWN. Next.js redacts a thrown Server Action message
 *     in production, so the client received React error #441 and rendered that
 *     literal string where the reason belonged. Refusals are now RETURNED.
 *  2. The gate was AUTHORSHIP (`createdByOrgUserId`), while the rest of the
 *     product had moved to org ownership (COU-002/COU-004, PR #523). A manager
 *     could see a colleague's course, was offered Delete, and was then refused —
 *     which is what produced the error in the first place.
 *
 * Neither `tsc` nor vitest can see problem 1 on its own: a test asserting
 * `.rejects` passes, because the promise really does reject. These assert on
 * the RETURN VALUE, and that no write happens on any refusing path.
 *
 * Q24 then turned the delete itself into an ARCHIVE write: the row is retained
 * and `archivedAt` is what hides it. Every assertion below pins `course.update`
 * with the archive payload — a `course.delete` reappearing here would destroy a
 * record the ruling says must survive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockNotifyLearnersCourseCancelled } = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
  mockNotifyLearnersCourseCancelled: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/notifications/create', () => ({ notifyOrganizationAdmins: vi.fn() }));
vi.mock('@/lib/course/notify-archived', () => ({
  notifyLearnersCourseCancelled: mockNotifyLearnersCourseCancelled,
}));

import { deleteCourse } from './course';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

function session(role: string, organizationUserId = 'ou-caller') {
  return {
    user: { id: 'u1', organizationId: ORG, organizationUserId, role },
  };
}

/** Authored by SOMEONE ELSE in the caller's org — the reported scenario. */
const colleaguesCourse = {
  id: 'course-1',
  title: 'Infection Control',
  isGlobal: false,
  organizationId: ORG,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(session('admin'));
  prismaMock.course.findUnique.mockResolvedValue(colleaguesCourse);
  prismaMock.course.update.mockResolvedValue({});
  mockNotifyLearnersCourseCancelled.mockResolvedValue({ notifiedCount: 0 });
});

describe('deleteCourse — refusals are returned, never thrown', () => {
  it.each([
    ['unauthenticated', () => mockAdminAuth.mockResolvedValue(null)],
    ['without course.delete', () => mockAdminAuth.mockResolvedValue(session('supervisor'))],
    [
      'for another organisation’s course',
      () =>
        prismaMock.course.findUnique.mockResolvedValue({
          id: 'course-1',
          isGlobal: false,
          organizationId: OTHER_ORG,
        }),
    ],
    [
      'for a course that does not exist',
      () => prismaMock.course.findUnique.mockResolvedValue(null),
    ],
  ])('resolves with a readable reason %s', async (_label, arrange) => {
    arrange();

    const result = await deleteCourse('course-1');

    expect(result.success).toBe(false);
    expect(result.error).toEqual(expect.any(String));
    expect(result.error).not.toMatch(/#441|minified/i);
    // Fail-closed: the refusal returns BEFORE any write.
    expect(prismaMock.course.update).not.toHaveBeenCalled();
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('names the shared catalogue rather than claiming a visible course is missing', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'catalog-1',
      isGlobal: true,
      organizationId: OTHER_ORG,
    });

    const result = await deleteCourse('catalog-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/shared catalogue/i);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('reports another org’s private course as absent, never as forbidden', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isGlobal: false,
      organizationId: OTHER_ORG,
    });

    const result = await deleteCourse('course-1');

    // Confirming it exists would leak another tenant's catalogue.
    expect(result.error).toBe('Course not found.');
  });
});

describe('deleteCourse — scoped to the organisation, not the author', () => {
  it('archives a course authored by a COLLEAGUE in the same org', async () => {
    // The reported case: the caller did not author it, and previously this
    // refused with a thrown "Course not found" → React error #441.
    mockAdminAuth.mockResolvedValue(session('admin', 'ou-someone-else'));

    const result = await deleteCourse('course-1');

    expect(result).toEqual({ success: true });
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: 'course-1' },
      data: {
        archivedAt: expect.any(Date),
        archivedByOrgUserId: 'ou-someone-else',
      },
    });
    // Q24: the row is RETAINED. A hard delete here would destroy the course,
    // its enrollments, its certificates and its stored video.
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('reads ownership off Course.organizationId, not a join through the author', async () => {
    await deleteCourse('course-1');

    const select = prismaMock.course.findUnique.mock.calls[0][0].select;
    expect(select).toHaveProperty('organizationId', true);
    // Q25 removed this join; re-adding it would still work today and silently
    // undo the migration onto the column.
    expect(select).not.toHaveProperty('creator');
  });

  it.each(['owner', 'admin', 'hr'])('lets %s delete their organisation’s course', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    await expect(deleteCourse('course-1')).resolves.toEqual({ success: true });
  });

  // clinical_director lost course.delete per founder Q3 ("Confirmed") — it
  // authors courses (CRU) but deletion is reserved for Owner/Admin/HR.
  it.each(['clinical_director', 'supervisor', 'finance', 'nurse'])(
    'refuses %s — no course.delete',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      const result = await deleteCourse('course-1');

      expect(result.success).toBe(false);
      expect(prismaMock.course.update).not.toHaveBeenCalled();
      expect(prismaMock.course.delete).not.toHaveBeenCalled();
    },
  );
});

/**
 * Founder Q-05 (2026-09-23): archiving is never blocked by live enrolments, but
 * the learners who still had something to do MUST be told the course is
 * cancelled — every action they had left is refused from this moment on.
 */
describe('deleteCourse — active learners are told the course is cancelled (Q-05)', () => {
  it('emits the cancellation notice, naming the course that was archived', async () => {
    const result = await deleteCourse('course-1');

    expect(result).toEqual({ success: true });
    expect(mockNotifyLearnersCourseCancelled).toHaveBeenCalledWith({
      id: 'course-1',
      title: 'Infection Control',
    });
    // Ordered: the notice tells learners the course IS cancelled, so it must not
    // go out ahead of the write that cancels it.
    expect(prismaMock.course.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockNotifyLearnersCourseCancelled.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [
      'refused for lack of permission',
      () => mockAdminAuth.mockResolvedValue(session('supervisor')),
    ],
    [
      'refused as another organisation’s course',
      () =>
        prismaMock.course.findUnique.mockResolvedValue({
          ...colleaguesCourse,
          organizationId: OTHER_ORG,
        }),
    ],
  ])('sends no notice when the archive was %s', async (_label, arrange) => {
    arrange();

    await deleteCourse('course-1');

    expect(mockNotifyLearnersCourseCancelled).not.toHaveBeenCalled();
  });
});
