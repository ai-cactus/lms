/**
 * The "Assigned roles" card and its embedded `RoleTargetPicker` (D5/D6).
 *
 * The card — and the picker inside it — only render once there is an
 * assignment AND that assignment already targets at least one role: a live
 * picker with nothing selected has no useful affordance here (adding the
 * FIRST role target stays with the assign wizard, which records the
 * assigner's own facility scope — see the component's own comment on
 * `pickerMode`). `canCreate`/`canRevoke` are passed straight through from the
 * page's own `assignment.create` / `assignment.delete` checks, so a
 * supervisor (create but not delete, D6) must render add-only.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { UserRole } from '@/generated/prisma/enums';
import type { RoleTargetPickerMode } from '@/components/dashboard/enrollment/RoleTargetPicker';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/components/ui', () => ({
  RowActionsMenu: () => <button type="button">Actions</button>,
}));

const { mockRoleTargetPicker } = vi.hoisted(() => ({ mockRoleTargetPicker: vi.fn() }));

vi.mock('@/components/dashboard/enrollment/RoleTargetPicker', () => ({
  __esModule: true,
  default: (props: { mode: RoleTargetPickerMode }) => {
    mockRoleTargetPicker(props);
    return <div data-testid="role-target-picker" />;
  },
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';
import type { CourseAssignmentSettings } from '@/app/actions/enrollment';

function baseCourse(overrides: Partial<CourseWithRelations> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    lessons: [],
    enrollments: [],
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    ...overrides,
  } as unknown as CourseWithRelations;
}

function assignmentSettings(
  overrides: Partial<CourseAssignmentSettings> = {},
): CourseAssignmentSettings {
  return {
    assignmentId: 'assign-1',
    scheduleAt: null,
    dueAt: null,
    dueWindowDays: null,
    renewalCycle: 'none',
    remindersEnabled: true,
    targetRole: null,
    targetRoles: ['nurse'] as UserRole[],
    facilityScoped: false,
    enrolledCount: 3,
    stages: [],
    ...overrides,
  } as unknown as CourseAssignmentSettings;
}

describe('TrainingDetails — role-target picker card (D5/D6)', () => {
  it('renders no card when there is no assignmentSettings at all', () => {
    render(<TrainingDetails course={baseCourse()} assignmentSettings={null} />);

    expect(screen.queryByText('Assigned roles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('role-target-picker')).not.toBeInTheDocument();
  });

  it('renders no card when the assignment targets no roles (empty targetRoles)', () => {
    render(
      <TrainingDetails
        course={baseCourse()}
        assignmentSettings={assignmentSettings({ targetRoles: [] })}
      />,
    );

    expect(screen.queryByText('Assigned roles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('role-target-picker')).not.toBeInTheDocument();
  });

  it('renders the card in live mode with the passed canCreate/canRevoke when targetRoles is non-empty', () => {
    render(
      <TrainingDetails
        course={baseCourse()}
        assignmentSettings={assignmentSettings({ targetRoles: ['nurse', 'hr'] as UserRole[] })}
        canCreateRoleTargets
        canRevokeRoleTargets
      />,
    );

    expect(screen.getByText('Assigned roles')).toBeInTheDocument();
    expect(screen.getByTestId('role-target-picker')).toBeInTheDocument();
    expect(mockRoleTargetPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: expect.objectContaining({
          kind: 'live',
          assignmentId: 'assign-1',
          enrolledCount: 3,
          canCreate: true,
          canRevoke: true,
        }),
      }),
    );
  });

  it('renders add-only for a supervisor: assignment.create but not assignment.delete (D6)', () => {
    render(
      <TrainingDetails
        course={baseCourse()}
        assignmentSettings={assignmentSettings()}
        canCreateRoleTargets={true}
        canRevokeRoleTargets={false}
      />,
    );

    expect(mockRoleTargetPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: expect.objectContaining({ canCreate: true, canRevoke: false }),
      }),
    );
  });
});
