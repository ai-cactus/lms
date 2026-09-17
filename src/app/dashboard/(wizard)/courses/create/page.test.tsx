/**
 * The course-creation wizard's two gates, which are deliberately different
 * shapes.
 *
 * RBAC (`course.create`) answers "Page not found" — founder ruling Q26
 * (docs/local/RBAC-founder-answers-2026-09-15.md): a module a role cannot access
 * is hidden from the nav AND unreachable by URL, because a redirect to
 * /dashboard still reveals that a wizard exists. Finance and Supervisor are the
 * two manager roles this refuses.
 *
 * BILLING still redirects to /dashboard/courses, where the gate UI explains
 * itself. Q26 governs "a role lacks access to a module"; an inactive
 * subscription is a fact about the organisation, not about the role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/components/dashboard/courses/CourseWizard', () => ({
  default: () => <div data-testid="course-wizard" />,
}));

import CreateCoursePage from './page';

function setSession(role: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      // Required: evaluatePermission masks the email into its denial warning.
      email: 'gate@test.invalid',
      role,
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('owner');
  prismaMock.organization.findUnique.mockResolvedValue({
    subscription: { status: 'active', pausedAt: null },
  });
});

describe('CreateCoursePage — course.create gate', () => {
  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'renders the wizard for %s, which holds course.create',
    async (role) => {
      setSession(role);

      await expect(CreateCoursePage()).resolves.toBeDefined();
      expect(mockNotFound).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    },
  );

  // Q26: the pair is the assertion. Dropping `onDeny` leaves `notFound`
  // uncalled and `redirect` called, so either half alone can pass for the
  // wrong reason.
  it.each(['finance', 'supervisor', 'front_desk_admin'])(
    '404s %s, which holds no course.create, before any billing read',
    async (role) => {
      setSession(role);

      await expect(CreateCoursePage()).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    },
  );

  it('redirects to /login when there is no session — not a 404', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(CreateCoursePage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // The billing gate is a different concern and deliberately keeps its redirect.
  it('still REDIRECTS an authorised role to /dashboard/courses without active billing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      subscription: { status: 'active', pausedAt: new Date('2026-09-01T00:00:00Z') },
    });

    await expect(CreateCoursePage()).rejects.toThrow('NEXT_REDIRECT:/dashboard/courses');
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
