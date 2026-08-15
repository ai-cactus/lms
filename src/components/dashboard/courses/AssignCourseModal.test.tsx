/**
 * Unit tests for src/components/dashboard/courses/AssignCourseModal.tsx
 *
 * The modal is the courses-list replacement for the /assign wizard page: paste
 * or type emails, they become removable chips, optionally pick a completion
 * deadline, then `assignCourseToUsers(courseId, emails, dueAt)` runs. These
 * tests guard the seams a component test can catch:
 *   - free-text parsing (commas / spaces / new lines) → chips, and the CTA
 *     count + disabled-at-zero rule derived from them;
 *   - the submitted payload, including the deadline picked from the calendar;
 *   - the static "Global" scope copy the design specifies;
 *   - server-reported unmatched emails surfacing in the modal instead of
 *     silently closing it.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAssignCourseToUsers, mockRouterRefresh } = vi.hoisted(() => ({
  mockAssignCourseToUsers: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({ assignCourseToUsers: mockAssignCourseToUsers }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import AssignCourseModal from './AssignCourseModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof AssignCourseModal>> = {}) {
  const onClose = vi.fn();
  render(
    <AssignCourseModal
      courseId="course-1"
      courseTitle="HIPAA Privacy Training"
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

const emailField = () => screen.getByLabelText('Assign by email');
const assignButton = () => screen.getByRole('button', { name: /^Assign to \d+ staff$/ });

beforeEach(() => {
  vi.clearAllMocks();
  mockAssignCourseToUsers.mockResolvedValue({ success: true, count: 2, notFound: [] });
});

describe('AssignCourseModal — header', () => {
  it('shows the course title with the static Global scope copy', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: 'Assign course' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'HIPAA Privacy Training · Global — staff in every facility can be assigned.',
      ),
    ).toBeInTheDocument();
  });
});

describe('AssignCourseModal — email parsing into chips', () => {
  it('starts with a disabled "Assign to 0 staff" CTA', () => {
    renderModal();

    expect(assignButton()).toHaveTextContent('Assign to 0 staff');
    expect(assignButton()).toBeDisabled();
  });

  it('turns a comma / space / newline separated paste into deduplicated chips', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(emailField());
    await user.paste('a@acme.com, b@acme.com c@acme.com\nA@acme.com');

    expect(screen.getByLabelText('Remove a@acme.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove b@acme.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove c@acme.com')).toBeInTheDocument();
    expect(assignButton()).toHaveTextContent('Assign to 3 staff');
  });

  it('commits a typed email on Enter and removes it again via its chip ×', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(emailField(), 'solo@acme.com{Enter}');
    expect(assignButton()).toHaveTextContent('Assign to 1 staff');

    await user.click(screen.getByLabelText('Remove solo@acme.com'));
    expect(assignButton()).toHaveTextContent('Assign to 0 staff');
    expect(assignButton()).toBeDisabled();
  });

  it('reports invalid entries and keeps the valid ones', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(emailField());
    await user.paste('good@acme.com, not-an-email');

    expect(assignButton()).toHaveTextContent('Assign to 1 staff');
    expect(screen.getByText(/1 entry was skipped/)).toBeInTheDocument();
  });

  it('collapses past six chips into a "+N more" chip that expands the full list', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(emailField());
    await user.paste(Array.from({ length: 9 }, (_, i) => `staff${i}@acme.com`).join(', '));

    expect(assignButton()).toHaveTextContent('Assign to 9 staff');
    expect(screen.getByText('+3 more')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove staff8@acme.com')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Show all 9 emails'));

    expect(screen.queryByText('+3 more')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove staff8@acme.com')).toBeInTheDocument();
  });
});

describe('AssignCourseModal — submission', () => {
  it('submits the parsed emails with a null deadline and closes on success', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(emailField());
    await user.paste('a@acme.com b@acme.com');
    await user.click(assignButton());

    await waitFor(() =>
      expect(mockAssignCourseToUsers).toHaveBeenCalledWith(
        'course-1',
        ['a@acme.com', 'b@acme.com'],
        null,
      ),
    );
    expect(mockRouterRefresh).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('submits the deadline picked from the calendar', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(emailField());
    await user.paste('a@acme.com');

    await user.click(screen.getByRole('button', { name: 'Completion deadline' }));
    const calendar = screen.getByRole('dialog', { name: 'Calendar' });
    // Page forward so every day in view is in the future (past days are disabled).
    await user.click(within(calendar).getAllByRole('button')[1]);
    await user.click(within(calendar).getByRole('button', { name: '15' }));

    await user.click(assignButton());

    await waitFor(() => expect(mockAssignCourseToUsers).toHaveBeenCalled());
    const [, , dueAt] = mockAssignCourseToUsers.mock.calls[0];
    expect(dueAt).toMatch(/^\d{4}-\d{2}-15$/);
  });

  it('keeps the modal open and lists emails the server could not match', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    mockAssignCourseToUsers.mockResolvedValue({
      success: true,
      count: 1,
      notFound: ['ghost@acme.com'],
    });

    await user.click(emailField());
    await user.paste('a@acme.com ghost@acme.com');
    await user.click(assignButton());

    expect(
      await screen.findByText(
        'Assigned to 1 staff. Not an active member of your organization: ghost@acme.com.',
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces the server message when no email resolves to a member', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    mockAssignCourseToUsers.mockResolvedValue({
      success: false,
      message: 'No valid users found to assign.',
      notFound: ['ghost@acme.com'],
    });

    await user.click(emailField());
    await user.paste('ghost@acme.com');
    await user.click(assignButton());

    expect(await screen.findByText('No valid users found to assign.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces a thrown server error', async () => {
    const user = userEvent.setup();
    renderModal();
    mockAssignCourseToUsers.mockRejectedValue(
      new Error('Your organization needs an active subscription to assign courses.'),
    );

    await user.click(emailField());
    await user.paste('a@acme.com');
    await user.click(assignButton());

    expect(
      await screen.findByText('Your organization needs an active subscription to assign courses.'),
    ).toBeInTheDocument();
  });
});
