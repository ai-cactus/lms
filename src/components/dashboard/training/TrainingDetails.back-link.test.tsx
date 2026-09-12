/**
 * "Go Back" used to always link to /dashboard/courses. That route is gated by
 * `requirePermission('course.read')`, which REDIRECTS on deny — so a viewer
 * who could open this page but lacked `course.read` (finance, since
 * 2026-08-25) was bounced straight back to it: a visibly dead button. The
 * page now computes `backHref` from the viewer's own permissions and this
 * component just renders wherever it's told, defaulting to `/dashboard`
 * (reachable by every role) so a caller that forgets the prop fails safe.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/components/ui', () => ({
  RowActionsMenu: () => <button type="button">Actions</button>,
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

function baseCourse(overrides: Partial<CourseWithRelations> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: 30,
    status: 'draft',
    reviewRequired: false,
    lessons: [],
    enrollments: [],
    // The hero reads both attribution relations (D10): `approvedBy` when the
    // publish reviewer was recorded, the creator otherwise. Both must be present
    // — as null, for approvedBy — or the hero throws before the link renders.
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    ...overrides,
  } as unknown as CourseWithRelations;
}

describe('TrainingDetails — "Go Back" link', () => {
  it('links to the caller-supplied backHref (e.g. /dashboard for a viewer without course.read)', () => {
    render(<TrainingDetails course={baseCourse()} backHref="/dashboard" />);

    expect(screen.getByRole('link', { name: /Go Back/ })).toHaveAttribute('href', '/dashboard');
  });

  it('links to /dashboard/courses when the caller supplies it (a viewer who holds course.read)', () => {
    render(<TrainingDetails course={baseCourse()} backHref="/dashboard/courses" />);

    expect(screen.getByRole('link', { name: /Go Back/ })).toHaveAttribute(
      'href',
      '/dashboard/courses',
    );
  });

  it('defaults to /dashboard when the prop is omitted — a caller that forgets it fails safe, not to the redirecting route', () => {
    render(<TrainingDetails course={baseCourse()} />);

    expect(screen.getByRole('link', { name: /Go Back/ })).toHaveAttribute('href', '/dashboard');
  });
});
