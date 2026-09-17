/**
 * Tests for the staff-profile "Change Role" modal — the UI caller founder answer
 * Q11 required and `updateStaffDetails` never had.
 *
 * Two things carry the ruling and must not regress:
 *   - the options come from `GRANTABLE_ROLES[viewerRole]`, so Owner and Admin
 *     are STRUCTURALLY ABSENT from an HR's list rather than offered and refused;
 *   - the payload echoes the member's current name and job title back unchanged,
 *     because `updateStaffDetails` takes all four fields together.
 *
 * Radix `Select` needs `hasPointerCapture` / `scrollIntoView` / `ResizeObserver`,
 * none of which jsdom provides — they are stubbed below.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChangeRoleModal from './ChangeRoleModal';
import type { EditableStaffMember } from './EditProfileModal';
import type { Role } from '@/types/next-auth';

const { updateStaffDetails, refresh } = vi.hoisted(() => ({
  updateStaffDetails: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/app/actions/staff', () => ({ updateStaffDetails }));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

const MEMBER: EditableStaffMember = {
  id: 'ou-1',
  name: 'Target User',
  email: 'target@example.com',
  firstName: 'Target',
  lastName: 'User',
  jobTitle: 'Staff Nurse',
  role: 'nurse',
};

function renderModal(viewerRole: Role = 'owner', member: EditableStaffMember = MEMBER) {
  const onClose = vi.fn();
  render(<ChangeRoleModal isOpen onClose={onClose} member={member} viewerRole={viewerRole} />);
  return { onClose };
}

async function openRoleList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox'));
  return screen.findByRole('listbox');
}

beforeEach(() => {
  vi.clearAllMocks();
  updateStaffDetails.mockResolvedValue({ success: true });
});

describe('ChangeRoleModal — role options', () => {
  // The Q11 assertion. HR may re-role anyone EXCEPT to Owner or Admin, and the
  // carve-out is structural: `GRANTABLE_ROLES.hr` omits both, so neither option
  // exists to be clicked. QA checked for exactly this.
  it('omits Owner and Admin entirely from an HR viewer’s options', async () => {
    const user = userEvent.setup();
    renderModal('hr');

    const listbox = await openRoleList(user);

    expect(within(listbox).queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /^Admin/ })).not.toBeInTheDocument();
    expect(
      within(listbox).getByRole('option', { name: /Facility Supervisor/ }),
    ).toBeInTheDocument();
  });

  it('offers Admin to an Owner viewer but never Owner itself', async () => {
    const user = userEvent.setup();
    renderModal('owner');

    const listbox = await openRoleList(user);

    expect(within(listbox).getByRole('option', { name: /^Admin/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
  });

  it('marks the role the member already holds as current and disables it', async () => {
    const user = userEvent.setup();
    renderModal('owner');

    const listbox = await openRoleList(user);
    const current = within(listbox).getByRole('option', { name: /Nurse \(current\)/ });

    expect(current).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ChangeRoleModal — confirm step', () => {
  it('requires a confirm step and names the consequence before writing anything', async () => {
    const user = userEvent.setup();
    renderModal('owner');

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /Case Manager/ }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));

    expect(screen.getByText(/signed out of any active session/)).toBeInTheDocument();
    expect(
      screen.getByText(/enrolled in any training assigned to Case Manager/),
    ).toBeInTheDocument();
    // Nothing is written until the second click.
    expect(updateStaffDetails).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(updateStaffDetails).toHaveBeenCalledTimes(1));
  });

  it('sends the new role with the member’s current name and job title UNCHANGED', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal('owner');

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /Case Manager/ }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(updateStaffDetails).toHaveBeenCalled());
    expect(updateStaffDetails).toHaveBeenCalledWith('ou-1', {
      role: 'case_manager',
      firstName: 'Target',
      lastName: 'User',
      jobTitle: 'Staff Nurse',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('cannot be confirmed before a role is chosen', () => {
    renderModal('owner');

    expect(screen.getByRole('button', { name: 'Change role' })).toBeDisabled();
  });

  // `canChangeRole` refuses for four distinct reasons and `updateStaffDetails`
  // already maps each to its own sentence — show what it returned, and return
  // the admin to the picker rather than leaving them on a dead confirm screen.
  it('shows the action’s own refusal and returns to the picker', async () => {
    const user = userEvent.setup();
    updateStaffDetails.mockResolvedValue({
      success: false,
      error: 'You cannot change your own role.',
    });
    const { onClose } = renderModal('owner');

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /Case Manager/ }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));

    expect(await screen.findByText('You cannot change your own role.')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
