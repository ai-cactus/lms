/**
 * Courses page tab strip — video-catalog entry-point regression.
 *
 * The "Available Video Courses" tab was removed by 0606da7 pending a redesigned
 * entry point that never landed, and shipped to production in PR #442. Nothing
 * failed: the server action, the card and the detail route all survived, so the
 * catalog was merely unreachable and CI stayed green for weeks. These tests pin
 * the reachable path — the tab exists, it deep-links, and it renders the rows —
 * so a future redesign that drops it has to fail here first.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CoursesPageTabs from './CoursesPageTabs';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard/courses',
  useSearchParams: () => new URLSearchParams('tab=available'),
}));

vi.mock('@/components/dashboard/courses/CoursesListClient', () => ({
  default: () => <div data-testid="my-courses" />,
}));

const videoCourse: VideoCourseAvailabilityRow = {
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

function renderTabs(availableCourses: VideoCourseAvailabilityRow[] = [videoCourse]) {
  return render(<CoursesPageTabs courses={[]} hasBilling availableCourses={availableCourses} />);
}

describe('CoursesPageTabs', () => {
  it('exposes the Available Video Courses tab', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: 'Available Video Courses' })).toBeInTheDocument();
  });

  it('renders the catalog when ?tab=available deep-links into it', () => {
    renderTabs();
    expect(screen.getByRole('link', { name: 'View Bloodborne Pathogens' })).toHaveAttribute(
      'href',
      '/dashboard/training/courses/course-1',
    );
  });

  it('shows the empty state rather than hiding the tab when the catalog is empty', () => {
    renderTabs([]);
    expect(screen.getByRole('tab', { name: 'Available Video Courses' })).toBeInTheDocument();
    expect(screen.getByText('No video courses available yet.')).toBeInTheDocument();
  });
});
