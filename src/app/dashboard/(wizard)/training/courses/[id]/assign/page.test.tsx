/**
 * The assign page re-resolves the course itself before rendering — it cannot
 * simply trust `enrollUsers`' own gate, because a course the action would
 * accept but the page's own lookup refuses is a SILENT redirect back to
 * `/dashboard/courses` with nothing to explain it.
 *
 * Phase 3 of the assign-surface consolidation (c42c6f9) routed the courses-list
 * row action here and, in doing so, exposed that the page's lookup was
 * strictly narrower than `enrollUsers`' `isSameOrgCourse`: it had no same-org
 * clause at all, only authorship / global-catalog / existing-offering. A
 * Supervisor authors no courses, so every course the list shows them is a
 * colleague's — every assign click would have bounced silently. The fix adds
 * `{ creator: { organizationId } }` to the `OR`.
 *
 * These tests pin the fixed lookup against the same shape `enrollUsers` uses
 * (see enrollment.test.ts's course-ownership fixtures), so the page and the
 * action it submits to cannot drift apart again unnoticed.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  prismaMock,
  mockRedirect,
  mockNotFound,
  mockGetCourseAssignmentSettings,
  mockGetRoleHolderCounts,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    organization: { findUnique: vi.fn() },
    course: { findFirst: vi.fn() },
    inviteCourseAssignment: { findMany: vi.fn() },
  },
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetCourseAssignmentSettings: vi.fn(async () => null),
  mockGetRoleHolderCounts: vi.fn(async () => ({})),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock('@/app/actions/enrollment', () => ({
  getCourseAssignmentSettings: mockGetCourseAssignmentSettings,
  getRoleHolderCounts: mockGetRoleHolderCounts,
}));
vi.mock('@/components/dashboard/training/AssignPublishClient', () => ({
  default: ({ courseId, courseTitle }: { courseId: string; courseTitle: string }) => (
    <div data-testid="assign-publish-client">
      {courseId} / {courseTitle}
    </div>
  ),
}));

import AssignCoursePage from './page';

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const ADMIN_ORG_USER_ID = 'ou-admin-1';
const COURSE_ID = 'course-1';

function setSession(role: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      // Required: evaluatePermission masks the email into its denial warning.
      email: 'gate@test.invalid',
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role,
    },
  });
}

function renderPage() {
  const params = Promise.resolve({ id: COURSE_ID });
  return AssignCoursePage({ params });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('supervisor');
  prismaMock.organization.findUnique.mockResolvedValue({
    subscription: { status: 'active', pausedAt: null },
  });
  prismaMock.inviteCourseAssignment.findMany.mockResolvedValue([]);
});

/**
 * `prisma.course.findFirst` is a mock, not a real query engine — it does not
 * itself apply an `OR` filter. To prove the route's fix behaves like the real
 * query, this evaluates the exact `where.OR` clauses the page builds against a
 * fixture course, the same way a real findFirst would AND the top-level `id`
 * with an OR of the given clauses.
 */
function resolveCourseAgainstWhere(course: Record<string, unknown> | null) {
  prismaMock.course.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; OR: Record<string, unknown>[] } }) => {
      if (!course || course.id !== where.id) return null;
      const matches = where.OR.some((clause) => clauseMatches(course, clause));
      return matches ? course : null;
    },
  );
}

function clauseMatches(course: Record<string, unknown>, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, expected]) => {
    if (key === 'creator') {
      const creator = course.creator as { organizationId: string } | undefined;
      const expectedOrgId = (expected as { organizationId: string }).organizationId;
      return creator?.organizationId === expectedOrgId;
    }
    if (key === 'offerings') {
      const offeringOrgIds = (course.offeringOrgIds as string[] | undefined) ?? [];
      const expectedOrgId = (
        (expected as { some: { organizationId: string } }).some as { organizationId: string }
      ).organizationId;
      return offeringOrgIds.includes(expectedOrgId);
    }
    return course[key] === expected;
  });
}

describe('AssignCoursePage — course lookup tenancy', () => {
  it('resolves a colleague-authored, non-global, never-offered course in the same org', async () => {
    resolveCourseAgainstWhere({
      id: COURSE_ID,
      title: 'Infection Control',
      status: 'published',
      isGlobal: false,
      createdByOrgUserId: 'ou-colleague-2', // not the caller
      creator: { organizationId: ORG_ID }, // but same org
    });

    const element = await renderPage();
    render(element);

    expect(screen.getByTestId('assign-publish-client')).toHaveTextContent(
      `${COURSE_ID} / Infection Control`,
    );
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('still resolves the caller’s own authored course', async () => {
    resolveCourseAgainstWhere({
      id: COURSE_ID,
      title: 'Own Course',
      status: 'draft',
      isGlobal: false,
      createdByOrgUserId: ADMIN_ORG_USER_ID,
      creator: { organizationId: ORG_ID },
    });

    const element = await renderPage();
    render(element);

    expect(screen.getByTestId('assign-publish-client')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('still resolves a global published catalog course authored by another org entirely', async () => {
    resolveCourseAgainstWhere({
      id: COURSE_ID,
      title: 'Platform Safety 101',
      status: 'published',
      isGlobal: true,
      // Only Theraptly's video uploads are ever global — the assign page's OR
      // arm now spells that discriminator out, so the fixture must too.
      type: 'video',
      createdByOrgUserId: 'ou-platform-1',
      creator: { organizationId: 'org-platform' },
    });

    const element = await renderPage();
    render(element);

    expect(screen.getByTestId('assign-publish-client')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('still resolves a course the org has an existing offering for, authored elsewhere', async () => {
    resolveCourseAgainstWhere({
      id: COURSE_ID,
      title: 'Adopted Catalog Course',
      status: 'published',
      isGlobal: true,
      createdByOrgUserId: 'ou-platform-1',
      creator: { organizationId: 'org-platform' },
      offeringOrgIds: [ORG_ID],
    });

    const element = await renderPage();
    render(element);

    expect(screen.getByTestId('assign-publish-client')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('still redirects for a course belonging to another organization entirely', async () => {
    resolveCourseAgainstWhere({
      id: COURSE_ID,
      title: 'Rival Org Course',
      status: 'published',
      isGlobal: false,
      createdByOrgUserId: 'ou-rival-1',
      creator: { organizationId: OTHER_ORG_ID }, // different org — must not match
    });

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard/courses');
  });

  it('redirects when no course matches at all', async () => {
    resolveCourseAgainstWhere(null);

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard/courses');
  });
});

/**
 * Founder ruling Q26 (docs/local/RBAC-founder-answers-2026-09-15.md): a role
 * that cannot access a module gets "Page not found", never a redirect.
 *
 * The page carries TWO refusals and only one of them is Q26's. The RBAC gate
 * (`assignment.create`) 404s; the BILLING gate still redirects to
 * /dashboard/courses, because a paused subscription is a fact about this
 * organisation rather than a statement about what this role may see — and
 * billing-plan-change-and-gating.spec.ts pins that redirect end-to-end.
 */
describe('AssignCoursePage — Q26 uniform deny', () => {
  it('404s Finance, which holds no assignment.create, before the billing read', async () => {
    setSession('finance');

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.course.findFirst).not.toHaveBeenCalled();
  });

  it('still REDIRECTS an authorised role to /dashboard/courses while billing is paused', async () => {
    setSession('supervisor');
    prismaMock.organization.findUnique.mockResolvedValue({
      subscription: { status: 'active', pausedAt: new Date('2026-09-01T00:00:00Z') },
    });

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard/courses');
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
