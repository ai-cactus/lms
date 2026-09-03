/**
 * The card that makes role-target auto-enrolment visible and reversible. Its
 * whole reason to exist is that a new staff account can arrive already enrolled,
 * and until now nothing in the app explained why or let an admin stop it.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRevoke } = vi.hoisted(() => ({ mockRevoke: vi.fn() }));

vi.mock('@/app/actions/enrollment', () => ({ revokeRoleAssignment: mockRevoke }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import RoleAssignmentsCard from './RoleAssignmentsCard';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ca-1',
    courseId: 'course-1',
    courseTitle: 'HIPAA Basics',
    targetRoles: ['nurse'],
    dueWindowDays: 30,
    facilityScoped: false,
    enrolledCount: 12,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRevoke.mockResolvedValue({ success: true });
});

describe('RoleAssignmentsCard', () => {
  it('says plainly that new staff get nothing when no assignment exists', () => {
    render(<RoleAssignmentsCard assignments={[]} canRevoke />);

    expect(screen.getByText(/No course is set to enrol staff automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('names the course, the targeted roles and how many it has enrolled', () => {
    render(<RoleAssignmentsCard assignments={[assignment()]} canRevoke />);

    expect(screen.getByText('HIPAA Basics')).toBeInTheDocument();
    expect(screen.getByText('Nurse')).toBeInTheDocument();
    expect(screen.getByText(/12 enrolled so far/)).toBeInTheDocument();
    expect(screen.getByText(/due 30 days after joining the role/)).toBeInTheDocument();
  });

  it('flags an assignment that only reaches some facilities', () => {
    render(<RoleAssignmentsCard assignments={[assignment({ facilityScoped: true })]} canRevoke />);

    expect(screen.getByText(/Limited to selected facilities/i)).toBeInTheDocument();
  });

  it('hides the Revoke action from a viewer without assignment.delete', () => {
    render(<RoleAssignmentsCard assignments={[assignment()]} canRevoke={false} />);

    expect(screen.getByText('HIPAA Basics')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('confirms before revoking, and says existing enrolments are kept', async () => {
    const user = userEvent.setup();
    render(<RoleAssignmentsCard assignments={[assignment()]} canRevoke />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Stop enrolling new staff\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/12 already enrolled\s+keep the course/i)).toBeInTheDocument();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    render(<RoleAssignmentsCard assignments={[assignment()]} canRevoke />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('revokes the assignment the admin chose', async () => {
    const user = userEvent.setup();
    render(
      <RoleAssignmentsCard
        assignments={[
          assignment(),
          assignment({ id: 'ca-2', courseTitle: 'Fire Safety', enrolledCount: 3 }),
        ]}
        canRevoke
      />,
    );

    const row = screen.getByText('Fire Safety').closest('li')!;
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke', hidden: false }));

    expect(mockRevoke).toHaveBeenCalledWith('ca-2');
  });

  it('surfaces a refusal in place instead of closing the dialog on failure', async () => {
    const user = userEvent.setup();
    mockRevoke.mockResolvedValue({ success: false, error: 'Unauthorized' });
    render(<RoleAssignmentsCard assignments={[assignment()]} canRevoke />);

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Revoke', hidden: false }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
  });
});
