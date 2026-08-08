/**
 * Tests for AddFacilityModal — the create-facility form driving
 * createFacility(). Covers required-field validation, the multi-select facility
 * type list and its "Other" free-text row, the supervisor combobox (roster
 * autocomplete OR free email entry), and the three-way confirmation copy
 * (assigned an existing supervisor / invited a stranger / invite failed).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateFacility, mockGetSupervisorOptions } = vi.hoisted(() => ({
  mockCreateFacility: vi.fn(),
  mockGetSupervisorOptions: vi.fn(),
}));

vi.mock('@/app/actions/organization', () => ({
  createFacility: mockCreateFacility,
  getSupervisorOptions: mockGetSupervisorOptions,
}));

import AddFacilityModal from './AddFacilityModal';

// jsdom has no ResizeObserver; Radix's Popover (via floating-ui) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const NAME_PLACEHOLDER = 'e.g. Sunrise Behavioral Health';
const SUPERVISOR_PLACEHOLDER = 'e.g. supervisor@yourfacility.com';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupervisorOptions.mockResolvedValue({ success: true, options: [] });
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
    expect(screen.getByText('Select at least one facility type')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('requires the free-text description when "Other (specify)" is toggled on', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('button', { name: 'Other (specify)' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Describe the facility type')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('rejects a malformed supervisor email', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Enter a valid supervisor email')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });
});

describe('AddFacilityModal — facility types', () => {
  beforeEach(() => {
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: false,
    });
  });

  it('submits every checked type and the trimmed name', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), '  Sunrise Clinic  ');
    await user.click(screen.getByRole('checkbox', { name: 'Community Mental Health Center' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith({
      name: 'Sunrise Clinic',
      types: ['Community Mental Health Center', 'Private Practice / Group Practice'],
      address: undefined,
      supervisorEmail: undefined,
    });
  });

  it('unchecking a type removes it from the payload', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    const first = screen.getByRole('checkbox', { name: 'Community Mental Health Center' });
    await user.click(first);
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.click(first);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['Private Practice / Group Practice'] }),
    );
  });

  it('appends the "Other" free text alongside the canonical labels, and never the sentinel', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Community Mental Health Center' }));
    await user.click(screen.getByRole('button', { name: 'Other (specify)' }));
    await user.type(screen.getByPlaceholderText('Describe the facility type'), ' Mobile crisis ');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['Community Mental Health Center', 'Mobile crisis'],
      }),
    );
  });

  it('unchecking the "Other" row restores the affordance and drops the free text', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('button', { name: 'Other (specify)' }));
    await user.type(screen.getByPlaceholderText('Describe the facility type'), 'Mobile crisis');
    await user.click(screen.getByRole('checkbox', { name: 'Other (specify)' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(screen.getByRole('button', { name: 'Other (specify)' })).toBeInTheDocument();
    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['Private Practice / Group Practice'] }),
    );
  });
});

describe('AddFacilityModal — supervisor combobox', () => {
  beforeEach(() => {
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: true,
    });
    mockGetSupervisorOptions.mockResolvedValue({
      success: true,
      options: [
        { organizationUserId: 'ou-1', fullName: 'Ada Lovelace', email: 'ada@acme.com' },
        { organizationUserId: 'ou-2', fullName: 'Grace Hopper', email: 'grace@acme.com' },
      ],
    });
  });

  it("opens the roster from the chevron and fills the selected supervisor's email", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(await screen.findByRole('button', { name: 'Show supervisors' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show supervisors' }));

    const listbox = await screen.findByRole('listbox', { name: 'Existing supervisors' });
    await user.click(within(listbox).getByRole('option', { name: /Ada Lovelace/ }));

    expect(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER)).toHaveValue('ada@acme.com');
    expect(screen.getByText('Existing supervisor: Ada Lovelace')).toBeInTheDocument();
  });

  it('filters the roster by name as the admin types', async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole('button', { name: 'Show supervisors' });
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'grace');

    const listbox = await screen.findByRole('listbox', { name: 'Existing supervisors' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    expect(within(listbox).getByRole('option', { name: /Grace Hopper/ })).toBeInTheDocument();
  });

  it('accepts a free-form email that matches nobody on the roster', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: true,
      supervisorAssigned: false,
    });
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'stranger@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ supervisorEmail: 'stranger@acme.com' }),
    );
  });
});

describe('AddFacilityModal — submit', () => {
  it('reports plain "Facility created." with no supervisor email', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: false,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onCreated).toHaveBeenCalledWith('Facility created.');
  });

  it('reports the assigned-supervisor message when the server assigned an existing member', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: true,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onCreated).toHaveBeenCalledWith(
      'Facility created. We assigned sup@acme.com to manage it.',
    );
  });

  it('reports the invited-supervisor message when the invite actually sent', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: true,
      supervisorAssigned: false,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
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
      supervisorAssigned: false,
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
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

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(
      await screen.findByText('You do not have permission to create facilities.'),
    ).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('surfaces the role-conflict rejection from the server', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: false,
      error:
        'That person is already a member of this organization as HR Manager. Change their role in Staff Management before assigning them as a facility supervisor.',
    });
    const { onCreated } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('checkbox', { name: 'Private Practice / Group Practice' }));
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'hr@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText(/already a member of this organization/)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
