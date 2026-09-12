/**
 * D8/D10 — the hero's attribution line.
 *
 * `approvedBy` records who signed the publish off (D8), but is a permanent,
 * reachable null: every course published before D8 shipped, plus any clean
 * draft `publishCourseOnAssignment` publishes as a side effect of being
 * assigned (D9) never gets a reviewer recorded. The hero falls back to the
 * CREATOR under a different label ("Created by") in that case, so the line
 * never implies a review that did not happen.
 *
 * `email` was added to both `approvedBy.user.select` and `creator.user.select`
 * (src/types/course.ts) specifically so this fallback has something to show
 * when `fullName` is null — without it the line would render with a blank
 * where the name goes.
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
    status: 'published',
    reviewRequired: false,
    lessons: [],
    enrollments: [],
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

describe('TrainingDetails — attribution line (D10)', () => {
  it('shows "Approved by: {fullName} ({role})" when a reviewer was recorded', () => {
    render(
      <TrainingDetails
        course={baseCourse({
          approvedBy: {
            role: 'hr',
            user: { email: 'reviewer@example.com', fullName: 'Rita Reviewer' },
          },
        })}
      />,
    );

    expect(screen.getByText('Approved by: Rita Reviewer (HR)')).toBeInTheDocument();
    expect(screen.queryByText(/Created by/)).not.toBeInTheDocument();
  });

  it('falls back to "Created by: {creator fullName} ({role})" when approvedBy is null', () => {
    render(
      <TrainingDetails
        course={baseCourse({
          approvedBy: null,
          creator: {
            userId: 'u-author',
            organizationId: 'org-1',
            role: 'admin',
            user: { email: 'author@example.com', fullName: 'Ada Author' },
          },
        })}
      />,
    );

    expect(screen.getByText('Created by: Ada Author (Admin)')).toBeInTheDocument();
    expect(screen.queryByText(/Approved by/)).not.toBeInTheDocument();
  });

  it('falls back to the reviewer’s email when their fullName is null', () => {
    render(
      <TrainingDetails
        course={baseCourse({
          approvedBy: {
            role: 'clinical_director',
            user: { email: 'no-name-reviewer@example.com', fullName: null },
          },
        })}
      />,
    );

    expect(
      screen.getByText('Approved by: no-name-reviewer@example.com (Clinical Director)'),
    ).toBeInTheDocument();
  });

  it('falls back to the creator’s email when their fullName is null (null approvedBy branch)', () => {
    render(
      <TrainingDetails
        course={baseCourse({
          approvedBy: null,
          creator: {
            userId: 'u-author',
            organizationId: 'org-1',
            role: 'supervisor',
            user: { email: 'no-name-creator@example.com', fullName: null },
          },
        })}
      />,
    );

    expect(
      screen.getByText('Created by: no-name-creator@example.com (Facility Supervisor)'),
    ).toBeInTheDocument();
  });
});
