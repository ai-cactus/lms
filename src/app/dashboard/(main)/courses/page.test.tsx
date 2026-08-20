/**
 * Regression tests for the /dashboard/courses video-catalog entry point.
 *
 * PR #442 removed the tab strip from this page while leaving every piece behind
 * it intact — listAvailableVideoCourses, VideoCourseCard and the course detail
 * route all still worked, so no test and no build failed. Production simply lost
 * the only way to reach the video catalog. Asserting the component in isolation
 * would not have caught that; the wiring on this page is what went missing, so
 * it is what these tests pin.
 *
 * Follows status-tracker/page.test.tsx: call the exported async Server Component
 * directly and assert on the resolved element, stubbing only the heavy child.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockGetCourses, mockListAvailableVideoCourses, mockRedirect } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    prismaMock: { organization: { findUnique: vi.fn() } },
    mockGetCourses: vi.fn(),
    mockListAvailableVideoCourses: vi.fn(),
    mockRedirect: vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    }),
  }));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard/courses',
  useSearchParams: () => new URLSearchParams('tab=available'),
}));
vi.mock('@/app/actions/course', () => ({ getCourses: mockGetCourses }));
vi.mock('@/app/actions/offering', () => ({
  listAvailableVideoCourses: mockListAvailableVideoCourses,
}));
vi.mock('@/components/dashboard/courses/CoursesListClient', () => ({
  default: () => <div data-testid="my-courses" />,
}));

import CoursesPage from './page';

const videoCourse = {
  id: 'course-1',
  title: 'Bloodborne Pathogens',
  description: 'Annual refresher',
  category: 'Safety',
  durationSeconds: 2700,
  questionCount: 10,
  hasPoster: true,
  isOffered: false,
  offeringId: null,
};

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
  mockListAvailableVideoCourses.mockResolvedValue([videoCourse]);
});

describe('CoursesPage — video catalog entry point', () => {
  it('fetches the global video catalog and renders its tab', async () => {
    render(await CoursesPage());

    expect(mockListAvailableVideoCourses).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('tab', { name: 'Available Video Courses' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Bloodborne Pathogens' })).toHaveAttribute(
      'href',
      '/dashboard/training/courses/course-1',
    );
  });

  it('still renders the page when the catalog lookup fails', async () => {
    mockListAvailableVideoCourses.mockRejectedValue(new Error('offering lookup down'));

    render(await CoursesPage());

    expect(screen.getByRole('tab', { name: 'Available Video Courses' })).toBeInTheDocument();
    expect(screen.getByText('No video courses available yet.')).toBeInTheDocument();
  });
});
