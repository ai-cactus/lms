/**
 * Tests for AddFacilityModal — the create-facility form driving
 * createFacility(). Covers required-field validation, the "Other" free-text
 * reveal, and the best-effort supervisor-invite confirmation copy (facility
 * created either way; the message differs by whether the invite actually sent).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateFacility } = vi.hoisted(() => ({ mockCreateFacility: vi.fn() }));

vi.mock('@/app/actions/organization', () => ({ createFacility: mockCreateFacility }));

import AddFacilityModal from './AddFacilityModal';

// jsdom has no ResizeObserver; Radix's RadioGroup (via useSize) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(onCreated = vi.fn()) {
  const onClose = vi.fn();
  render(<AddFacilityModal isOpen onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

describe('AddFacilityModal — validation', () => {
  it('shows required-field errors and never calls createFacility when submitted empty', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Facility name is required')).toBeInTheDocument();
    expect(screen.getByText('Select a facility type')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('requires the free-text description when "Other (specify)" is selected', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Other (specify)' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Describe the facility type')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('blocks submission for a malformed supervisor email (the input is type="email", enforced by the browser\'s own constraint validation ahead of React Hook Form)', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText('supervisor@example.com'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).not.toHaveBeenCalled();
  });
});

describe('AddFacilityModal — submit', () => {
  it('submits the selected type and trimmed fields, and reports plain "Facility created." with no supervisor email', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), '  Sunrise Clinic  ');
    await user.click(screen.getByRole('radio', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith({
      name: 'Sunrise Clinic',
      type: 'Private Practice / Group Practice',
      address: undefined,
      supervisorEmail: undefined,
    });
    expect(onCreated).toHaveBeenCalledWith('Facility created.');
  });

  it('submits the free-text type when "Other" is chosen', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
    });
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Other (specify)' }));
    await user.type(
      screen.getByPlaceholderText('Describe the facility type'),
      'Mobile crisis unit',
    );
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Mobile crisis unit' }),
    );
  });

  it('reports the invited-supervisor message when the invite actually sent', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: true,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText('supervisor@example.com'), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onCreated).toHaveBeenCalledWith(
      'Facility created. We invited sup@acme.com to manage it.',
    );
  });

  it('reports the invite-failed-but-facility-created message when the invite did not send', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText('supervisor@example.com'), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onCreated).toHaveBeenCalledWith(
      'Facility created, but the invite to sup@acme.com could not be sent. Invite them from Staff Details.',
    );
  });

  it('shows the server error and does not call onCreated when createFacility fails', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: false,
      error: 'You do not have permission to create facilities.',
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText('Enter facility name'), 'Sunrise Clinic');
    await user.click(screen.getByRole('radio', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(
      await screen.findByText('You do not have permission to create facilities.'),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
