/**
 * The "Withdraw assignment" row action.
 *
 * removeWorkerAssignment shipped with NO caller anywhere in the product, so an
 * assignment could be created and never withdrawn — a mis-assigned training
 * stayed on a learner's record unless the staff member was deleted outright.
 *
 * The control is offered only where the action would actually succeed: its
 * server gate is course-creator, and the page computes that. Rendering it for
 * everyone would turn a permission refusal into a dead menu item.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));
vi.mock('@/app/actions/enrollment', () => ({ removeWorkerAssignment: mockRemove }));

// Render the action LABELS so the menu's contents are assertable, rather than
// the opaque trigger the sibling spec stubs.
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({ actions }: { actions: { label: string }[] }) => (
    <div data-testid="row-actions">
      {actions.map((a) => (
        <span key={a.label}>{a.label}</span>
      ))}
    </div>
  ),
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

function courseWithEnrollment(): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    lessons: [],
    enrollments: [
      {
        id: 'enr-1',
        status: 'in_progress',
        organizationUser: { user: { fullName: 'Nina Nurse', email: 'nina@example.com' } },
      },
    ],
  } as unknown as CourseWithRelations;
}

describe('TrainingDetails — withdraw assignment action', () => {
  it('offers the action when the viewer may withdraw', () => {
    render(<TrainingDetails course={courseWithEnrollment()} canWithdrawAssignments />);

    expect(screen.getByText('Withdraw assignment')).toBeInTheDocument();
  });

  it('hides it when the viewer may not — no dead menu item for a refusal', () => {
    render(<TrainingDetails course={courseWithEnrollment()} canWithdrawAssignments={false} />);

    expect(screen.queryByText('Withdraw assignment')).not.toBeInTheDocument();
    // The rest of the menu is unaffected.
    expect(screen.getByText('Assign Retake')).toBeInTheDocument();
  });

  it('defaults to hidden when the prop is omitted — a page that forgets to pass it cannot leak the control', () => {
    render(<TrainingDetails course={courseWithEnrollment()} />);

    expect(screen.queryByText('Withdraw assignment')).not.toBeInTheDocument();
  });
});
