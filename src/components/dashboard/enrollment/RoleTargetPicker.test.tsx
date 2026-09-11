/**
 * The one shared chip-input role picker (D5): stages a selection in `draft`
 * mode (the wizard, and the assign page before an assignment row exists) and
 * writes straight through to `setRoleAssignmentTargets` in `live` mode (the
 * assign page and course-details page once a row exists). Removal is a soft
 * revoke (D6) that persists enrollments untouched — the picker's job is to make
 * the consequence explicit before it happens.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRole } from '@/generated/prisma/enums';

const { mockSetRoleAssignmentTargets } = vi.hoisted(() => ({
  mockSetRoleAssignmentTargets: vi.fn(),
}));

vi.mock('@/app/actions/enrollment', () => ({
  setRoleAssignmentTargets: mockSetRoleAssignmentTargets,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import RoleTargetPicker, { type RoleTargetPickerMode } from './RoleTargetPicker';
import { getRoleDisplayName, GRANTABLE_ROLES } from '@/lib/rbac/role-utils';

// The catalog the picker renders, in its real groupRolesForSelect('owner')
// order — every grantable role except `owner` itself.
const MANAGER_ROLES = ['admin', 'supervisor', 'hr', 'clinical_director', 'finance'] as UserRole[];
const WORKER_ROLES = [...GRANTABLE_ROLES.owner].filter(
  (role) => !MANAGER_ROLES.includes(role as UserRole) && role !== 'owner',
) as UserRole[];

const LIVE_REVOKABLE: RoleTargetPickerMode = {
  kind: 'live',
  assignmentId: 'ca-1',
  enrolledCount: 12,
  canCreate: true,
  canRevoke: true,
};

function renderPicker(
  overrides: {
    selectedRoles?: UserRole[];
    onSelectionChange?: (roles: UserRole[]) => void;
    mode?: RoleTargetPickerMode;
    onLiveUpdateError?: (message: string) => void;
  } = {},
) {
  const onSelectionChange = overrides.onSelectionChange ?? vi.fn();
  const onLiveUpdateError = overrides.onLiveUpdateError ?? vi.fn();
  const utils = render(
    <RoleTargetPicker
      selectedRoles={overrides.selectedRoles ?? []}
      onSelectionChange={onSelectionChange}
      mode={overrides.mode ?? { kind: 'draft' }}
      onLiveUpdateError={onLiveUpdateError}
    />,
  );
  return { ...utils, onSelectionChange, onLiveUpdateError };
}

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose roles' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetRoleAssignmentTargets.mockResolvedValue({ success: true, enrolled: 0 });
});

describe('RoleTargetPicker — draft vs live removal (item 8)', () => {
  it('draft mode removes a role with no confirm dialog', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({ selectedRoles: ['nurse'] });

    await user.click(screen.getByRole('button', { name: 'Remove Nurse' }));

    expect(onSelectionChange).toHaveBeenCalledWith([]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockSetRoleAssignmentTargets).not.toHaveBeenCalled();
  });

  it('live mode opens a confirm naming enrolledCount before removing', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({
      selectedRoles: ['nurse'],
      mode: LIVE_REVOKABLE,
    });

    await user.click(screen.getByRole('button', { name: 'Remove Nurse' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Stop enrolling new staff\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/12 already enrolled/i)).toBeInTheDocument();
    // Nothing committed until the confirm is accepted.
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(mockSetRoleAssignmentTargets).not.toHaveBeenCalled();
  });
});

describe('RoleTargetPicker — confirm cancel and server refusal (item 9)', () => {
  it('cancelling the confirm leaves the selection unchanged', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({
      selectedRoles: ['nurse'],
      mode: LIVE_REVOKABLE,
    });

    await user.click(screen.getByRole('button', { name: 'Remove Nurse' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(mockSetRoleAssignmentTargets).not.toHaveBeenCalled();
    // The chip is still there — nothing reverted because nothing changed.
    expect(screen.getByText('Nurse')).toBeInTheDocument();
  });

  it('a server refusal reverts (never commits) and surfaces via onLiveUpdateError', async () => {
    mockSetRoleAssignmentTargets.mockResolvedValue({
      success: false,
      refusedReason: 'You do not have permission to remove roles from this assignment.',
    });
    const user = userEvent.setup();
    const { onSelectionChange, onLiveUpdateError } = renderPicker({
      selectedRoles: ['nurse'],
      mode: LIVE_REVOKABLE,
    });

    await user.click(screen.getByRole('button', { name: 'Remove Nurse' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(onLiveUpdateError).toHaveBeenCalledWith(
        'You do not have permission to remove roles from this assignment.',
      ),
    );
    // The checkbox/chip selection is never applied on a refusal.
    expect(onSelectionChange).not.toHaveBeenCalled();
    // The refusal is also shown inline, inside the still-open dialog.
    expect(
      screen.getByText('You do not have permission to remove roles from this assignment.'),
    ).toBeInTheDocument();
  });
});

describe('RoleTargetPicker — None (item 10)', () => {
  it('selecting None clears the selection', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({ selectedRoles: ['nurse', 'hr'] });

    await openDropdown(user);
    await user.click(screen.getByRole('checkbox', { name: 'None' }));

    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('None is checked by default and unchecked once a concrete role is selected', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPicker({ selectedRoles: [] });

    await openDropdown(user);
    expect(screen.getByRole('checkbox', { name: 'None' })).toBeChecked();

    rerender(
      <RoleTargetPicker
        selectedRoles={['nurse']}
        onSelectionChange={vi.fn()}
        mode={{ kind: 'draft' }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'None' })).not.toBeChecked();
  });

  it('selecting a concrete role reports it and never re-adds None to the stored list', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({ selectedRoles: [] });

    await openDropdown(user);
    await user.click(screen.getByRole('checkbox', { name: 'Nurse' }));

    expect(onSelectionChange).toHaveBeenCalledWith(['nurse']);
  });
});

describe('RoleTargetPicker — D4 EVERYONE group expansion (item 11)', () => {
  it('ticking EVERYONE > Managers checks and reports every manager role individually', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({ selectedRoles: [] });

    await openDropdown(user);
    await user.click(screen.getByRole('checkbox', { name: 'Managers' }));

    // The expanded concrete list, not a bucket value — this is what
    // enrollUserForRoleTargets and the nightly sweep actually match on.
    expect(onSelectionChange).toHaveBeenCalledWith(MANAGER_ROLES);
    expect(onSelectionChange).not.toHaveBeenCalledWith(
      expect.arrayContaining(['EVERYONE' as unknown as UserRole]),
    );
  });

  it('ticking EVERYONE > Workers / Learners checks and reports every worker role individually', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderPicker({ selectedRoles: [] });

    await openDropdown(user);
    await user.click(screen.getByRole('checkbox', { name: 'Workers / Learners' }));

    expect(onSelectionChange).toHaveBeenCalledWith(WORKER_ROLES);
  });

  it('once every manager role is individually selected, the Managers group checkbox reads as checked', async () => {
    const user = userEvent.setup();
    renderPicker({ selectedRoles: MANAGER_ROLES });

    await openDropdown(user);

    expect(screen.getByRole('checkbox', { name: 'Managers' })).toBeChecked();
  });
});

describe('RoleTargetPicker — full role catalog (item 12)', () => {
  it('renders all 13 assignable roles with their registry display names, owner absent', async () => {
    const user = userEvent.setup();
    renderPicker({ selectedRoles: [] });

    await openDropdown(user);

    const allRoles = [...MANAGER_ROLES, ...WORKER_ROLES];
    expect(allRoles).toHaveLength(13);
    for (const role of allRoles) {
      expect(screen.getByRole('checkbox', { name: getRoleDisplayName(role) })).toBeInTheDocument();
    }
    expect(screen.queryByText(getRoleDisplayName('owner'))).not.toBeInTheDocument();
    // None + 2 group rows + 13 concrete roles.
    expect(screen.getAllByRole('checkbox')).toHaveLength(16);
  });
});

describe('RoleTargetPicker — canRevoke: false (item 13)', () => {
  it('disables removal entirely: no chip ✕ and the checked role stays checked but disabled', async () => {
    const user = userEvent.setup();
    renderPicker({
      selectedRoles: ['nurse'],
      mode: { ...LIVE_REVOKABLE, canRevoke: false },
    });

    expect(screen.queryByRole('button', { name: 'Remove Nurse' })).not.toBeInTheDocument();

    await openDropdown(user);
    const nurseCheckbox = screen.getByRole('checkbox', { name: 'Nurse' });
    expect(nurseCheckbox).toBeChecked();
    expect(nurseCheckbox).toBeDisabled();
  });

  it('an unselected role may still be added even though revoke is disabled', async () => {
    const user = userEvent.setup();
    renderPicker({
      selectedRoles: ['nurse'],
      mode: { ...LIVE_REVOKABLE, canRevoke: false },
    });

    await openDropdown(user);
    const hrCheckbox = screen.getByRole('checkbox', { name: 'HR' });
    expect(hrCheckbox).not.toBeDisabled();
  });
});
