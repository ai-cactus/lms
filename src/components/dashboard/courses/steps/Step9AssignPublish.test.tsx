/**
 * Tests for the "Assigning & Publish" wizard step.
 *
 * The step owns the two assignment modes (whole roles vs individual email
 * invites), the deadline / reminder / recurring schedule the publish path sends
 * to the server, and its own Publish gate via `isAssignSelectionValid`. The role
 * catalog is the real RBAC one, so the dropdown is asserted against
 * `groupRolesForSelect` rather than a hard-coded label list.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchStaffUsers } = vi.hoisted(() => ({ mockSearchStaffUsers: vi.fn() }));

vi.mock('@/app/actions/user', () => ({ searchStaffUsers: mockSearchStaffUsers }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Step9AssignPublish, { isAssignSelectionValid } from './Step9AssignPublish';
import { getRoleDisplayName, groupRolesForSelect } from '@/lib/rbac/role-utils';
import { CourseWizardData } from '@/types/course';
import { WIZARD_FORM_DATA } from './wizardTestData';

// jsdom stubs Radix Select depends on.
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

const ROLE_GROUPS = groupRolesForSelect('owner');
const MANAGER_ROLES = ROLE_GROUPS.find((g) => g.label === 'Managers')!.roles.map((r) => r.value);
const WORKER_ROLES = ROLE_GROUPS.find((g) => g.label === 'Workers / Learners')!.roles.map(
  (r) => r.value,
);

function renderStep(overrides: Partial<CourseWizardData> = {}) {
  const onChange = vi.fn();
  render(<Step9AssignPublish data={{ ...WIZARD_FORM_DATA, ...overrides }} onChange={onChange} />);
  return { onChange };
}

async function openRoles(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Choose roles' }));
  return screen.getByRole('group', { name: 'Assignable roles' });
}

beforeEach(() => {
  mockSearchStaffUsers.mockReset();
  mockSearchStaffUsers.mockResolvedValue([]);
});

describe('isAssignSelectionValid', () => {
  it('requires at least one role in role mode', () => {
    expect(isAssignSelectionValid({ assignMode: 'roles', assignRoles: [], assignments: [] })).toBe(
      false,
    );
    expect(
      isAssignSelectionValid({ assignMode: 'roles', assignRoles: ['nurse'], assignments: [] }),
    ).toBe(true);
  });

  it('requires at least one recipient in email mode, whatever the role selection is', () => {
    expect(
      isAssignSelectionValid({ assignMode: 'email', assignRoles: ['nurse'], assignments: [] }),
    ).toBe(false);
    expect(
      isAssignSelectionValid({ assignMode: 'email', assignRoles: [], assignments: ['a@b.com'] }),
    ).toBe(true);
  });
});

describe('Step9AssignPublish — assignment modes', () => {
  it('renders the step heading and its two assignment tabs', () => {
    renderStep();

    expect(screen.getByRole('heading', { name: 'Assigning & Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select by Roles/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Individual Email Invite/ })).toBeInTheDocument();
  });

  it('shows the role picker in role mode and the email chip input in email mode', () => {
    const { unmount } = render(
      <Step9AssignPublish data={{ ...WIZARD_FORM_DATA }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Choose roles' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Add people, emails or names')).not.toBeInTheDocument();
    unmount();

    renderStep({ assignMode: 'email' });
    expect(screen.getByPlaceholderText('Add people, emails or names')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose roles' })).not.toBeInTheDocument();
  });

  it('switches the stored mode when the other tab is picked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    await user.click(screen.getByRole('button', { name: /Individual Email Invite/ }));

    expect(onChange).toHaveBeenCalledWith('assignMode', 'email');
  });
});

describe('Step9AssignPublish — role selection', () => {
  it('lists every assignable role under its group once the picker is opened', async () => {
    const user = userEvent.setup();
    renderStep();

    const list = await openRoles(user);

    expect(within(list).getByText('EVERYONE')).toBeInTheDocument();
    expect(within(list).getByText('MANAGERS')).toBeInTheDocument();
    expect(within(list).getByText('WORKERS / LEARNERS')).toBeInTheDocument();
    for (const role of [...MANAGER_ROLES, ...WORKER_ROLES]) {
      expect(
        within(list).getByRole('checkbox', { name: getRoleDisplayName(role) }),
      ).toBeInTheDocument();
    }
  });

  it('adds a ticked role to the assignment', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    const list = await openRoles(user);
    await user.click(within(list).getByRole('checkbox', { name: getRoleDisplayName('nurse') }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', ['nurse']);
  });

  it('keeps the stored roles in catalog order however they are ticked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignRoles: ['nurse'] });

    const list = await openRoles(user);
    await user.click(within(list).getByRole('checkbox', { name: getRoleDisplayName('hr') }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', ['hr', 'nurse']);
  });

  it('removes an unticked role', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignRoles: ['hr', 'nurse'] });

    const list = await openRoles(user);
    await user.click(within(list).getByRole('checkbox', { name: getRoleDisplayName('nurse') }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', ['hr']);
  });

  it('selects every worker role from the "Workers / Learners" group row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    const list = await openRoles(user);
    await user.click(within(list).getByRole('checkbox', { name: 'Workers / Learners' }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', WORKER_ROLES);
  });

  it('clears only that group when its row is unticked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignRoles: [...MANAGER_ROLES, ...WORKER_ROLES] });

    const list = await openRoles(user);
    await user.click(within(list).getByRole('checkbox', { name: 'Managers' }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', WORKER_ROLES);
  });

  it('renders a removable chip per selected role', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignRoles: ['hr', 'nurse'] });

    expect(screen.getByText(getRoleDisplayName('hr'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${getRoleDisplayName('hr')}` }));

    expect(onChange).toHaveBeenCalledWith('assignRoles', ['nurse']);
  });
});

describe('Step9AssignPublish — deadline, reminders and recurrence', () => {
  it('reveals the due date and time only while the deadline toggle is on', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    expect(screen.queryByRole('button', { name: 'Due date' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Set Completion Deadline' }));
    expect(onChange).toHaveBeenCalledWith('dueDeadlineEnabled', true);

    renderStep({ dueDeadlineEnabled: true });
    expect(screen.getByRole('button', { name: 'Due date' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Due time')).toBeInTheDocument();
  });

  it('renders one editable row per reminder', () => {
    renderStep({
      reminders: [
        { value: 7, unit: 'days' },
        { value: 3, unit: 'days' },
      ],
    });

    expect(screen.getByLabelText('Reminder 1 days before deadline')).toHaveValue(7);
    expect(screen.getByLabelText('Reminder 2 days before deadline')).toHaveValue(3);
  });

  it('updates a reminder offset', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ reminders: [{ value: 7, unit: 'days' }] });

    await user.type(screen.getByLabelText('Reminder 1 days before deadline'), '0');

    expect(onChange).toHaveBeenCalledWith('reminders', [{ value: 70, unit: 'days' }]);
  });

  it('removes a reminder row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({
      reminders: [
        { value: 7, unit: 'days' },
        { value: 3, unit: 'days' },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Remove reminder 1' }));

    expect(onChange).toHaveBeenCalledWith('reminders', [{ value: 3, unit: 'days' }]);
  });

  it('adds a reminder row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ reminders: [{ value: 7, unit: 'days' }] });

    await user.click(screen.getByRole('button', { name: /Add reminder/ }));

    expect(onChange).toHaveBeenCalledWith('reminders', [
      { value: 7, unit: 'days' },
      { value: 1, unit: 'days' },
    ]);
  });

  it('stops adding rows once the reminder ladder is full', () => {
    renderStep({
      reminders: [
        { value: 7, unit: 'days' },
        { value: 3, unit: 'days' },
        { value: 1, unit: 'days' },
      ],
    });

    expect(screen.getByRole('button', { name: /Add reminder/ })).toBeDisabled();
  });

  it('reveals the interval picker only while the recurring toggle is on', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep();

    expect(screen.queryByRole('combobox', { name: 'Select interval' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Recurring Course Requirement' }));
    expect(onChange).toHaveBeenCalledWith('recurringEnabled', true);

    renderStep({ recurringEnabled: true, renewalCycle: 'annual' });
    expect(screen.getByRole('combobox', { name: 'Select interval' })).toHaveTextContent(
      'Annual (12 months)',
    );
  });

  it('resets the interval to "none" when recurrence is switched off', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ recurringEnabled: true, renewalCycle: 'annual' });

    await user.click(screen.getByRole('switch', { name: 'Recurring Course Requirement' }));

    expect(onChange).toHaveBeenCalledWith('recurringEnabled', false);
    expect(onChange).toHaveBeenCalledWith('renewalCycle', 'none');
  });
});

describe('Step9AssignPublish — individual email invites', () => {
  it('adds a typed email as a chip', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignMode: 'email' });

    const input = screen.getByPlaceholderText('Add people, emails or names');
    await user.type(input, 'worker@test.com{Enter}');

    expect(onChange).toHaveBeenCalledWith('assignments', ['worker@test.com']);
  });

  it('rejects a malformed email', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignMode: 'email' });

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'nope{Enter}');

    expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an existing recipient chip', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStep({ assignMode: 'email', assignments: ['worker@test.com'] });

    await user.click(screen.getByRole('button', { name: 'Remove worker@test.com' }));

    expect(onChange).toHaveBeenCalledWith('assignments', []);
  });
});
