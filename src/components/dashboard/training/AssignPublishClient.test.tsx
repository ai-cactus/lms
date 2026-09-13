/**
 * AssignPublishClient had no unit test file at all before this — the exact gap
 * that let the Due Date field sit hidden in role mode on a false premise ("role
 * targets never carry an absolute due date"). Covers: which fields render in
 * each mode (Due Date must render in BOTH now), the toggle labels, and that
 * each submit branch sends the deadline under the right key plus the
 * `dueWindowDays` round-trip (both paths write that column unconditionally, so
 * omitting it would silently clear an org's wizard-set window).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserRole } from '@/generated/prisma/enums';
import type { RoleTargetPickerMode } from '@/components/dashboard/enrollment/RoleTargetPicker';
import type { CourseAssignmentSettings } from '@/app/actions/enrollment';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The shared DatePicker portals a calendar to <body>; swap it for a plain input
// so these tests exercise the page's field wiring, not the picker's grid.
vi.mock('@/components/ui/DatePicker', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const { mockRoleTargetPicker } = vi.hoisted(() => ({ mockRoleTargetPicker: vi.fn() }));

vi.mock('@/components/dashboard/enrollment/RoleTargetPicker', () => ({
  __esModule: true,
  default: (props: {
    mode: RoleTargetPickerMode;
    selectedRoles: UserRole[];
    onSelectionChange: (roles: UserRole[]) => void;
  }) => {
    mockRoleTargetPicker(props);
    return (
      <button
        type="button"
        data-testid="role-target-picker"
        onClick={() => props.onSelectionChange(['nurse'] as UserRole[])}
      >
        Choose roles (stub)
      </button>
    );
  },
}));

const mockEnrollUsers = vi.fn();
const mockAssignCourseToRoles = vi.fn();

vi.mock('@/app/actions/enrollment', () => ({
  enrollUsers: (...args: unknown[]) => mockEnrollUsers(...args),
  assignCourseToRoles: (...args: unknown[]) => mockAssignCourseToRoles(...args),
}));

const mockPublishCourse = vi.fn();
vi.mock('@/app/actions/course', () => ({
  publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
}));

import AssignPublishClient from './AssignPublishClient';

function existingSettings(
  overrides: Partial<CourseAssignmentSettings> = {},
): CourseAssignmentSettings {
  return {
    assignmentId: 'assign-1',
    scheduleAt: null,
    dueAt: null,
    dueWindowDays: null,
    renewalCycle: 'annual',
    remindersEnabled: true,
    targetRole: null,
    targetRoles: [],
    facilityScoped: false,
    enrolledCount: 0,
    stages: [],
    ...overrides,
  } as unknown as CourseAssignmentSettings;
}

function renderClient(props: Partial<React.ComponentProps<typeof AssignPublishClient>> = {}) {
  return render(
    <AssignPublishClient
      courseId="course-1"
      courseTitle="Infection Control"
      courseStatus="published"
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnrollUsers.mockResolvedValue({
    success: [],
    failed: [],
    newInvited: [],
    refusedReason: null,
  });
  mockAssignCourseToRoles.mockResolvedValue({
    assignmentId: 'assign-1',
    holderCount: 1,
    enrolled: 1,
    alreadyEnrolled: 0,
    failed: 0,
    refusedReason: null,
    targetRoles: ['nurse'],
  });
  mockPublishCourse.mockResolvedValue({ success: true });
});

describe('AssignPublishClient — mode toggle', () => {
  it('labels the toggle buttons "Specific people" and "Roles"', () => {
    renderClient();

    expect(screen.getByRole('button', { name: 'Specific people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Roles' })).toBeInTheDocument();
  });

  it('defaults to people mode with no existing role targets', () => {
    renderClient();

    expect(screen.getByRole('button', { name: 'Specific people' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByTestId('role-target-picker')).not.toBeInTheDocument();
  });

  it('defaults to role mode when existingSettings already targets roles', () => {
    renderClient({
      existingSettings: existingSettings({ targetRoles: ['nurse'] as UserRole[] }),
    });

    expect(screen.getByRole('button', { name: 'Roles' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('role-target-picker')).toBeInTheDocument();
  });
});

describe('AssignPublishClient — Due Date renders in both modes', () => {
  it('renders Due Date in people mode', () => {
    renderClient();

    expect(screen.getByRole('heading', { name: 'Due Date' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select due date')).toBeInTheDocument();
  });

  it('renders Due Date in role mode too — the fix under test', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Roles' }));

    expect(screen.getByRole('heading', { name: 'Due Date' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select due date')).toBeInTheDocument();
  });

  it('still renders the people entry field only in people mode', async () => {
    const user = userEvent.setup();
    renderClient();

    expect(screen.getByPlaceholderText('Add people, emails or names')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Roles' }));

    expect(screen.queryByPlaceholderText('Add people, emails or names')).not.toBeInTheDocument();
    expect(screen.getByTestId('role-target-picker')).toBeInTheDocument();
  });
});

describe('AssignPublishClient — submit payloads', () => {
  it('people mode sends dueAt (not dueDate) and dueWindowDays:null with no existing settings', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.type(screen.getByPlaceholderText('Select due date'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings).toEqual(
      expect.objectContaining({
        dueAt: new Date('2026-12-01'),
        dueWindowDays: null,
      }),
    );
    expect(settings).not.toHaveProperty('dueDate');
  });

  it('role mode sends dueDate (not dueAt) to assignCourseToRoles', async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole('button', { name: 'Roles' }));
    await user.click(screen.getByTestId('role-target-picker')); // selects ['nurse']
    await user.type(screen.getByPlaceholderText('Select due date'), '2026-12-01');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(settings).toEqual(
      expect.objectContaining({
        dueDate: new Date('2026-12-01'),
        dueWindowDays: null,
      }),
    );
    expect(settings).not.toHaveProperty('dueAt');
  });

  it('round-trips a wizard-set dueWindowDays through the people-mode submit instead of nulling it', async () => {
    const user = userEvent.setup();
    renderClient({ existingSettings: existingSettings({ dueWindowDays: 45 }) });

    await user.type(screen.getByPlaceholderText('Add people, emails or names'), 'worker@test.com,');
    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockEnrollUsers).toHaveBeenCalledTimes(1));
    const [, , settings] = mockEnrollUsers.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ dueWindowDays: 45 }));
  });

  it('round-trips a wizard-set dueWindowDays through the role-mode submit instead of nulling it', async () => {
    const user = userEvent.setup();
    renderClient({
      existingSettings: existingSettings({
        dueWindowDays: 45,
        targetRoles: ['nurse'] as UserRole[],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Assign Course' }));

    await waitFor(() => expect(mockAssignCourseToRoles).toHaveBeenCalledTimes(1));
    const [, , settings] = mockAssignCourseToRoles.mock.calls[0];
    expect(settings).toEqual(expect.objectContaining({ dueWindowDays: 45 }));
  });
});
