/**
 * Tests for the staff-profile "Edit Profile" modal — the UI caller founder
 * answer Q2 required and `updateStaffDetails` never had.
 *
 * The load-bearing assertion is the payload: the action takes name, job title
 * AND role together, so this modal must echo the member's CURRENT role back
 * unchanged. Sending anything else would route a supervisor's name correction
 * through the action's role-change branch.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EditProfileModal, { type EditableStaffMember } from './EditProfileModal';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const updateStaffDetails = vi.fn();
vi.mock('@/app/actions/staff', () => ({
  updateStaffDetails: (...args: unknown[]) => updateStaffDetails(...args),
}));

const MEMBER: EditableStaffMember = {
  id: 'ou-1',
  name: 'Target User',
  email: 'target@example.com',
  firstName: 'Target',
  lastName: 'User',
  jobTitle: 'Staff Nurse',
  role: 'nurse',
};

function renderModal(member: EditableStaffMember = MEMBER) {
  const onClose = vi.fn();
  render(<EditProfileModal isOpen onClose={onClose} member={member} />);
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateStaffDetails.mockResolvedValue({ success: true });
});

describe('EditProfileModal', () => {
  it('prefills the member’s current name and job title', () => {
    renderModal();

    expect(screen.getByLabelText(/First name/)).toHaveValue('Target');
    expect(screen.getByLabelText(/Last name/)).toHaveValue('User');
    expect(screen.getByLabelText(/Job title/)).toHaveValue('Staff Nurse');
  });

  it('saves the edited name and job title, sending the current role UNCHANGED', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.clear(screen.getByLabelText(/First name/));
    await user.type(screen.getByLabelText(/First name/), 'Tola');
    await user.clear(screen.getByLabelText(/Job title/));
    await user.type(screen.getByLabelText(/Job title/), 'Charge Nurse');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateStaffDetails).toHaveBeenCalledTimes(1));
    expect(updateStaffDetails).toHaveBeenCalledWith('ou-1', {
      firstName: 'Tola',
      lastName: 'User',
      jobTitle: 'Charge Nurse',
      // ⛔ The member's existing role. A supervisor reaches this action under Q2
      // but is not a role-change actor — sending any other value here would hit
      // `canChangeRole` and be refused with `actor_not_permitted`.
      role: 'nurse',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('trims surrounding whitespace before saving', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(screen.getByLabelText(/Last name/));
    await user.type(screen.getByLabelText(/Last name/), '  Adeyemi  ');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateStaffDetails).toHaveBeenCalled());
    expect(updateStaffDetails.mock.calls[0][1]).toMatchObject({ lastName: 'Adeyemi' });
  });

  it('rejects an empty name without calling the action', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(screen.getByLabelText(/First name/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('First name is required.')).toBeInTheDocument();
    expect(updateStaffDetails).not.toHaveBeenCalled();
  });

  // Server Actions redact THROWN messages in production (React #441), so
  // `updateStaffDetails` returns its refusal. Display what it returned.
  it('surfaces the refusal the action returns rather than a generic failure', async () => {
    const user = userEvent.setup();
    updateStaffDetails.mockResolvedValue({ success: false, error: 'Forbidden' });
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('prefills empty fields for a member with no recorded name or job title', () => {
    renderModal({ ...MEMBER, firstName: '', lastName: '', jobTitle: '' });

    expect(screen.getByLabelText(/Job title/)).toHaveValue('');
  });
});
