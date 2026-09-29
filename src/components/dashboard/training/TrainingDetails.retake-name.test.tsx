/**
 * BUG-54: the "Assign Retake" row action opened AssignRetakeModal with
 * `userName=""`, so the dialog read "…a new retake attempt for  on the course…".
 * The row now hands the modal the learner it was opened from.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/actions/enrollment', () => ({ removeWorkerAssignment: vi.fn() }));

// Menu items as plain buttons, so the row action can be driven directly.
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({
    actions,
  }: {
    actions: { label: string; disabled?: boolean; onSelect?: () => void }[];
  }) => (
    <div data-testid="row-actions">
      {actions.map((a) => (
        <button key={a.label} type="button" disabled={a.disabled} onClick={a.onSelect}>
          {a.label}
        </button>
      ))}
    </div>
  ),
}));

// The modal's own copy and due-date logic are another branch's concern; this
// pins only what the row passes in.
vi.mock('./AssignRetakeModal', () => ({
  default: ({ userName, courseName }: { userName: string; courseName: string }) => (
    <div data-testid="retake-modal">
      {userName}|{courseName}
    </div>
  ),
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

function courseWithLockedLearner(user: { fullName: string | null; email: string }) {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    lessons: [],
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    enrollments: [{ id: 'enr-1', status: 'locked', organizationUser: { user } }],
  } as unknown as CourseWithRelations;
}

describe('TrainingDetails — Assign Retake names the learner (BUG-54)', () => {
  it('passes the learner’s full name to the retake dialog', async () => {
    const user = userEvent.setup();
    render(
      <TrainingDetails
        course={courseWithLockedLearner({ fullName: 'Nina Nurse', email: 'nina@example.com' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assign Retake' }));

    expect(screen.getByTestId('retake-modal')).toHaveTextContent('Nina Nurse|Infection Control');
  });

  it('falls back to the learner’s email when they have no name on record', async () => {
    const user = userEvent.setup();
    render(
      <TrainingDetails
        course={courseWithLockedLearner({ fullName: null, email: 'nina@example.com' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Assign Retake' }));

    expect(screen.getByTestId('retake-modal')).toHaveTextContent('nina@example.com|');
  });
});
