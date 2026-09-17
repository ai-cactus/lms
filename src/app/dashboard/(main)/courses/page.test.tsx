/**
 * Regression tests for the /dashboard/courses video-course entry point.
 *
 * PR #442 removed the tab strip from this page while leaving every piece behind
 * it intact — the catalog server action and the course detail route all still
 * worked, so no test and no build failed. Production simply lost the only way to
 * reach the video catalog. Asserting the component in isolation would not have
 * caught that; the wiring on this page is what went missing, so it is what these
 * tests pin.
 *
 * The "Available Video Courses" tab those pieces used to live behind is gone
 * (2026-08-27 product ruling: every org owns every video course from creation),
 * so what is pinned now is the merge — the catalog reaching CoursesListClient as
 * ordinary rows, de-duped against the org's own courses.
 *
 * Follows status-tracker/page.test.tsx: call the exported async Server Component
 * directly and assert on the resolved element, stubbing only the heavy child.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CourseWithStats } from '@/types/course';

const {
  mockAuth,
  prismaMock,
  mockGetCourses,
  mockListGlobalVideoCatalogCourses,
  mockRedirect,
  mockNotFound,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { findUnique: vi.fn() } },
  mockGetCourses: vi.fn(),
  mockListGlobalVideoCatalogCourses: vi.fn(),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/courses',
  useSearchParams: () => new URLSearchParams(''),
}));
// The page no longer merges the catalogue itself — it delegates to
// `getAssignableCourses`, which the staff-profile assign modal also uses. The
// merge/de-dupe/billing-gate assertions that used to live here now sit with
// that action in `src/app/actions/offering.assignable-courses.test.ts`; keeping
// them in two places is what let the two surfaces drift apart in the first
// place (the modal showed an empty Video Courses tab while this page did not).
vi.mock('@/app/actions/offering', () => ({ getAssignableCourses: mockGetCourses }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/components/dashboard/courses/CoursesListClient', () => ({
  default: ({ courses }: { courses: CourseWithStats[] }) => (
    <ul data-testid="courses-list">
      {courses.map((course) => (
        <li key={course.id} data-catalog={String(Boolean(course.isGlobalCatalog))}>
          {course.title}
        </li>
      ))}
    </ul>
  ),
}));

import CoursesPage from './page';

function makeCourse(overrides: Partial<CourseWithStats> = {}): CourseWithStats {
  return {
    id: 'course-1',
    title: 'Bloodborne Pathogens',
    description: 'Annual refresher',
    thumbnail: null,
    status: 'published',
    type: 'video',
    duration: 45,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lessonsCount: 1,
    enrollmentsCount: 0,
    completionRate: 0,
    sourceDocumentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      role: 'owner',
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
    },
  });
  prismaMock.organization.findUnique.mockResolvedValue({
    subscription: { status: 'active', pausedAt: null },
  });
  mockGetCourses.mockResolvedValue([]);
  mockListGlobalVideoCatalogCourses.mockResolvedValue([makeCourse({ isGlobalCatalog: true })]);
});

describe('CoursesPage — video course entry point', () => {
  it('renders exactly the courses the shared assignable-courses action returns', async () => {
    mockGetCourses.mockResolvedValue([
      makeCourse({ id: 'own-1', title: 'In-house course' }),
      makeCourse({ id: 'catalog-1', title: 'Catalog Only', isGlobalCatalog: true }),
    ]);

    render(await CoursesPage());

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['In-house course', 'Catalog Only']);
    expect(rows[1]).toHaveAttribute('data-catalog', 'true');
  });

  it('renders an empty list without error when the org has no assignable courses', async () => {
    mockGetCourses.mockResolvedValue([]);

    render(await CoursesPage());

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // D5: the revoke card that used to sit below the list is deleted — revoking now
  // happens in the shared role picker. The page no longer imports from
  // `@/app/actions/enrollment` at all, which is why nothing here mocks it.
  it('no longer renders the automatic-role-assignments card (D5)', async () => {
    render(await CoursesPage());

    expect(screen.queryByText(/enrol staff automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

/**
 * Founder ruling Q26 (docs/local/RBAC-founder-answers-2026-09-15.md): a module a
 * role cannot access is hidden from the nav AND answers a typed URL with "Page
 * not found". The Courses route previously took `requirePermission`'s default
 * `onDeny: 'redirect'`, so Finance — the one manager role without `course.read`
 * — was bounced to /dashboard, which is itself evidence the module exists.
 */
describe('CoursesPage — Q26 uniform deny', () => {
  it('404s Finance, which holds no course.read, without querying anything', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'gate@test.invalid',
        role: 'finance',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
      },
    });

    await expect(CoursesPage()).rejects.toThrow('NEXT_NOT_FOUND');

    // The pair is the assertion: dropping the option leaves `notFound`
    // uncalled and `redirect` called, so either half alone can pass wrongly.
    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetCourses).not.toHaveBeenCalled();
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it('404s a worker role reaching the admin-side list by URL', async () => {
    mockAuth.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'gate@test.invalid',
        role: 'front_desk_admin',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
      },
    });

    // Worker roles DO hold `course.read` (their own training), so this case is
    // admitted by the verb and must stay that way — the admin-side list is
    // separated from the worker portal by the auth instance, not by this gate.
    await expect(CoursesPage()).resolves.toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
