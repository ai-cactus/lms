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
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth } = vi.hoisted(() => ({
  prismaMock: {
    course: { findUnique: vi.fn(), delete: vi.fn() },
  },
  mockAdminAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('./notifications', () => ({ notifyOrganizationAdmins: vi.fn() }));

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
  isGlobal: false,
  creator: { organizationId: ORG },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(session('admin'));
  prismaMock.course.findUnique.mockResolvedValue(colleaguesCourse);
  prismaMock.course.delete.mockResolvedValue({});
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
          creator: { organizationId: OTHER_ORG },
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
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('names the shared catalogue rather than claiming a visible course is missing', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'catalog-1',
      isGlobal: true,
      creator: { organizationId: OTHER_ORG },
    });

    const result = await deleteCourse('catalog-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/shared catalogue/i);
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });

  it('reports another org’s private course as absent, never as forbidden', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      isGlobal: false,
      creator: { organizationId: OTHER_ORG },
    });

    const result = await deleteCourse('course-1');

    // Confirming it exists would leak another tenant's catalogue.
    expect(result.error).toBe('Course not found.');
  });
});

describe('deleteCourse — scoped to the organisation, not the author', () => {
  it('deletes a course authored by a COLLEAGUE in the same org', async () => {
    // The reported case: the caller did not author it, and previously this
    // refused with a thrown "Course not found" → React error #441.
    mockAdminAuth.mockResolvedValue(session('admin', 'ou-someone-else'));

    const result = await deleteCourse('course-1');

    expect(result).toEqual({ success: true });
    expect(prismaMock.course.delete).toHaveBeenCalledWith({ where: { id: 'course-1' } });
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'lets %s delete their organisation’s course',
    async (role) => {
      mockAdminAuth.mockResolvedValue(session(role));

      await expect(deleteCourse('course-1')).resolves.toEqual({ success: true });
    },
  );

  it.each(['supervisor', 'finance', 'nurse'])('refuses %s — no course.delete', async (role) => {
    mockAdminAuth.mockResolvedValue(session(role));

    const result = await deleteCourse('course-1');

    expect(result.success).toBe(false);
    expect(prismaMock.course.delete).not.toHaveBeenCalled();
  });
});
