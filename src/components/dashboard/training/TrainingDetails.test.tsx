/**
 * Regression tests for Issue #13: TrainingDetails used to hardcode a permanent
 * "Active" status badge and an "Approved by: Admin" badge regardless of the
 * course's real state. Both are now derived — the status badge from
 * `courseStatusBadge(status, reviewRequired)`, and the "Approved by" badge was
 * removed entirely (CoursePreview now shows "Created by" instead — see
 * CoursePreview.tsx). This suite pins the label mapping as rendered by the
 * real component and asserts "Approved by: Admin" can never reappear.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// TrainingDetails imports ONLY `RowActionsMenu` from the `@/components/ui`
// barrel (Button/Input/Table/Badge/EmptyTableState all come from their own
// files) — stubbing the whole barrel here has no blast radius on the rest of
// the component, and sidesteps Radix's untested dropdown internals.
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
    ...overrides,
  } as unknown as CourseWithRelations;
}

describe('TrainingDetails — status badge (Issue #13)', () => {
  it('shows "Active" for a published course', () => {
    render(<TrainingDetails course={baseCourse({ status: 'published', reviewRequired: false })} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Needs Review" for a draft held by the F-051 quality gate', () => {
    render(<TrainingDetails course={baseCourse({ status: 'draft', reviewRequired: true })} />);
    expect(screen.getByText('Needs Review')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows "Draft" for an ordinary unpublished draft', () => {
    render(<TrainingDetails course={baseCourse({ status: 'draft', reviewRequired: false })} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('shows "Inactive" for the inactive status', () => {
    render(<TrainingDetails course={baseCourse({ status: 'inactive', reviewRequired: false })} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('never renders the old hardcoded "Approved by: Admin" badge, in any state', () => {
    for (const [status, reviewRequired] of [
      ['published', false],
      ['draft', true],
      ['draft', false],
      ['inactive', false],
    ] as const) {
      const { unmount } = render(
        <TrainingDetails course={baseCourse({ status, reviewRequired })} />,
      );
      expect(screen.queryByText(/Approved by/i)).not.toBeInTheDocument();
      unmount();
    }
  });
});
