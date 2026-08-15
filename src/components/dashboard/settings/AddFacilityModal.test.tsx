/**
 * Tests for AddFacilityModal — one form in two modes.
 *
 * Create mode drives createFacility(); passing a `facility` flips it to
 * "Update facility" and drives updateFacility() with that id. Covers
 * required-field validation, the facility-type dropdown multi-select (chips,
 * per-chip removal, the "Other" free-text row), the supervisor combobox
 * (roster autocomplete OR free email entry), and the three-way confirmation
 * copy (assigned an existing supervisor / invited a stranger / invite failed).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateFacility, mockUpdateFacility, mockGetSupervisorOptions } = vi.hoisted(() => ({
  mockCreateFacility: vi.fn(),
  mockUpdateFacility: vi.fn(),
  mockGetSupervisorOptions: vi.fn(),
}));

vi.mock('@/app/actions/organization', () => ({
  createFacility: mockCreateFacility,
  updateFacility: mockUpdateFacility,
  getSupervisorOptions: mockGetSupervisorOptions,
}));

import AddFacilityModal, { type EditableFacility } from './AddFacilityModal';

// jsdom has no ResizeObserver; Radix's Popover (via floating-ui) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const NAME_PLACEHOLDER = 'e.g. Sunrise Behavioral Health';
const SUPERVISOR_PLACEHOLDER = 'e.g. supervisor@yourfacility.com';
const OTHER = 'Other (specify)';
const PRIVATE_PRACTICE = 'Private Practice / Group Practice';
const COMMUNITY = 'Community Mental Health Center';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSupervisorOptions.mockResolvedValue({ success: true, options: [] });
});

function renderModal(facility: EditableFacility | null = null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(<AddFacilityModal isOpen facility={facility} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
}

/** Open the type dropdown, toggle each label, then close it again. */
async function toggleTypes(user: User, ...labels: string[]) {
  await user.click(screen.getByRole('button', { name: 'Facility type' }));
  for (const label of labels) {
    await user.click(await screen.findByRole('checkbox', { name: label }));
  }
  await user.keyboard('{Escape}');
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

  it('requires the free-text description when "Other (specify)" is checked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, OTHER);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Describe the facility type')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('rejects a malformed supervisor email', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText('Enter a valid supervisor email')).toBeInTheDocument();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });
});

describe('AddFacilityModal — facility type multi-select', () => {
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
    await toggleTypes(user, COMMUNITY, PRIVATE_PRACTICE);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith({
      name: 'Sunrise Clinic',
      types: [COMMUNITY, PRIVATE_PRACTICE],
      address: undefined,
      supervisorEmail: undefined,
    });
  });

  it('counts the selections in the label badge and collapses the overflow into "+n more"', async () => {
    const user = userEvent.setup();
    renderModal();

    await toggleTypes(
      user,
      COMMUNITY,
      PRIVATE_PRACTICE,
      'Behavioral Health Hospital / Psychiatric Hospital',
    );

    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('unchecking a type removes it from the payload', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, COMMUNITY, PRIVATE_PRACTICE, COMMUNITY);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: [PRIVATE_PRACTICE] }),
    );
  });

  it("a chip's remove control drops that type without opening the dropdown", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, COMMUNITY, PRIVATE_PRACTICE);
    await user.click(screen.getByRole('button', { name: `Remove ${COMMUNITY}` }));
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: [PRIVATE_PRACTICE] }),
    );
  });

  it('appends the "Other" free text alongside the canonical labels, and never the sentinel', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('button', { name: 'Facility type' }));
    await user.click(await screen.findByRole('checkbox', { name: COMMUNITY }));
    await user.click(screen.getByRole('checkbox', { name: OTHER }));
    await user.type(screen.getByPlaceholderText('Describe the facility type'), ' Mobile crisis ');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: [COMMUNITY, 'Mobile crisis'] }),
    );
  });

  it('unchecking the "Other" row drops the free text from the payload', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await user.click(screen.getByRole('button', { name: 'Facility type' }));
    await user.click(await screen.findByRole('checkbox', { name: OTHER }));
    await user.type(screen.getByPlaceholderText('Describe the facility type'), 'Mobile crisis');
    await user.click(screen.getByRole('checkbox', { name: OTHER }));
    await user.click(screen.getByRole('checkbox', { name: PRIVATE_PRACTICE }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ types: [PRIVATE_PRACTICE] }),
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
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'stranger@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(mockCreateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ supervisorEmail: 'stranger@acme.com' }),
    );
  });
});

describe('AddFacilityModal — create submit', () => {
  it('reports plain "Facility created." with no supervisor email', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: false,
    });
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onSaved).toHaveBeenCalledWith('Facility created.');
  });

  it('reports the assigned-supervisor message when the server assigned an existing member', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: true,
    });
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onSaved).toHaveBeenCalledWith(
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
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onSaved).toHaveBeenCalledWith('Facility created. We invited sup@acme.com to manage it.');
  });

  it('reports the invite-failed-but-facility-created message when the invite did not send', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: true,
      facilityId: 'fac-1',
      supervisorInvited: false,
      supervisorAssigned: false,
    });
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'sup@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(onSaved).toHaveBeenCalledWith(
      'Facility created, but the invite to sup@acme.com could not be sent. Invite them from Staff Details.',
    );
  });

  it('shows the server error and does not call onSaved when createFacility fails', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: false,
      error: 'You do not have permission to create facilities.',
    });
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(
      await screen.findByText('You do not have permission to create facilities.'),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('surfaces the role-conflict rejection from the server', async () => {
    const user = userEvent.setup();
    mockCreateFacility.mockResolvedValue({
      success: false,
      error:
        'That person is already a member of this organization as HR Manager. Change their role in Staff Management before assigning them as a facility supervisor.',
    });
    const { onSaved } = renderModal();

    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise Clinic');
    await toggleTypes(user, PRIVATE_PRACTICE);
    await user.type(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER), 'hr@acme.com');
    await user.click(screen.getByRole('button', { name: 'Create facility' }));

    expect(await screen.findByText(/already a member of this organization/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('AddFacilityModal — update mode', () => {
  const facility: EditableFacility = {
    id: 'fac-9',
    name: 'Sunrise Behavioral Health',
    type: `${COMMUNITY}, Mobile crisis`,
    address: '12 Elm Street',
    supervisorEmail: 'courtney.henry@clinic.org',
  };

  beforeEach(() => {
    mockUpdateFacility.mockResolvedValue({
      success: true,
      supervisorAssigned: false,
      supervisorInvited: false,
    });
  });

  it('renders the update title and prefills every field from the facility', async () => {
    renderModal(facility);

    expect(await screen.findByRole('heading', { name: 'Update facility' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(NAME_PLACEHOLDER)).toHaveValue('Sunrise Behavioral Health');
    expect(screen.getByPlaceholderText('Add facility address')).toHaveValue('12 Elm Street');
    expect(screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER)).toHaveValue(
      'courtney.henry@clinic.org',
    );
    // A stored label outside the canonical list round-trips through "Other".
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByText('Mobile crisis')).toBeInTheDocument();
  });

  it('submits the facility id with the joined type string and no supervisor when unchanged', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderModal(facility);

    await user.clear(screen.getByPlaceholderText(NAME_PLACEHOLDER));
    await user.type(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'Sunrise BH');
    await user.click(screen.getByRole('button', { name: 'Update facility' }));

    expect(mockUpdateFacility).toHaveBeenCalledWith({
      facilityId: 'fac-9',
      name: 'Sunrise BH',
      type: `${COMMUNITY}, Mobile crisis`,
      address: '12 Elm Street',
      supervisorEmail: undefined,
    });
    expect(onSaved).toHaveBeenCalledWith('Facility updated.');
  });

  it('sends a changed supervisor and reports the hand-over', async () => {
    const user = userEvent.setup();
    mockUpdateFacility.mockResolvedValue({
      success: true,
      supervisorAssigned: true,
      supervisorInvited: false,
    });
    const { onSaved } = renderModal(facility);

    const supervisor = screen.getByPlaceholderText(SUPERVISOR_PLACEHOLDER);
    await user.clear(supervisor);
    await user.type(supervisor, 'new.sup@clinic.org');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Update facility' }));

    expect(mockUpdateFacility).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: 'fac-9', supervisorEmail: 'new.sup@clinic.org' }),
    );
    expect(onSaved).toHaveBeenCalledWith(
      'Facility updated. We assigned new.sup@clinic.org to manage it.',
    );
  });

  it('shows the server error and does not call onSaved when updateFacility fails', async () => {
    const user = userEvent.setup();
    mockUpdateFacility.mockResolvedValue({ success: false, error: 'Facility not found' });
    const { onSaved } = renderModal(facility);

    await user.click(screen.getByRole('button', { name: 'Update facility' }));

    expect(await screen.findByText('Facility not found')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
