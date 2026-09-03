/**
 * Gating tests for the staff-profile "Change Facility" button (design: Staff
 * Profile header, next to Assign Course). The button must render only for
 * viewers holding user.edit, only when the viewer has MULTI-facility access
 * (a viewer who can see one site has nowhere to reassign anyone to), and never
 * for the organization owner's own profile (the owner's facilities are
 * immutable).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import StaffProfileClient from './StaffProfileClient';
import type { Role } from '@/types/next-auth';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/app/actions/certificate', () => ({
  getAdminWorkerCertificates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/app/actions/staff', () => ({
  getEnrollmentQuizResult: vi.fn(),
  setStaffFacilities: vi.fn(),
}));

const FACILITIES = [
  { id: 'fac-a', name: 'Akobo branch', type: null, city: null },
  { id: 'fac-b', name: 'Akingbile branch', type: null, city: null },
];

function makeStaff(role = 'nurse') {
  return {
    user: {
      id: 'ou-1',
      name: 'Target User',
      email: 'target@example.com',
      avatarUrl: null,
      role,
      jobTitle: 'Nurse',
      facilityName: 'Akobo branch',
    },
    stats: { totalCourses: 0, completedCourses: 0, failedCourses: 0, activeCourses: 0 },
    enrollments: [],
  };
}

describe('StaffProfileClient — Change Facility button', () => {
  it('renders for a viewer with user.edit and opens the change-facility modal', async () => {
    const user = userEvent.setup();
    render(
      <StaffProfileClient
        staff={makeStaff()}
        viewerRole={'owner' as Role}
        facilities={FACILITIES}
      />,
    );

    const button = screen.getByRole('button', { name: /Change Facility/ });
    await user.click(button);

    expect(screen.getByRole('heading', { name: 'Change facility' })).toBeInTheDocument();
    expect(screen.getByText(/Current · Akobo branch/)).toBeInTheDocument();
  });

  it('is hidden for a viewer without user.edit (clinical_director)', () => {
    render(
      <StaffProfileClient
        staff={makeStaff()}
        viewerRole={'clinical_director' as Role}
        facilities={FACILITIES}
      />,
    );

    expect(screen.queryByRole('button', { name: /Change Facility/ })).not.toBeInTheDocument();
  });

  // An org-wide role is not assigned to a facility at all, so there is nothing
  // to change. Shown DISABLED rather than hidden: on a standalone control that
  // says "this exists but does not apply here", where a missing button just
  // looks like a permission the viewer lacks. `setStaffFacilities` refuses it
  // server-side regardless.
  it.each(['owner', 'admin', 'hr', 'clinical_director', 'finance'])(
    'is present but disabled when the profile belongs to a %s',
    (role) => {
      render(
        <StaffProfileClient
          staff={makeStaff(role)}
          viewerRole={'admin' as Role}
          facilities={FACILITIES}
        />,
      );

      expect(screen.getByRole('button', { name: /Change Facility/ })).toBeDisabled();
    },
  );

  it.each(['supervisor', 'nurse', 'front_desk_admin'])(
    'stays enabled for a facility-bound %s',
    (role) => {
      render(
        <StaffProfileClient
          staff={makeStaff(role)}
          viewerRole={'admin' as Role}
          facilities={FACILITIES}
        />,
      );

      expect(screen.getByRole('button', { name: /Change Facility/ })).toBeEnabled();
    },
  );

  it('explains why it is disabled rather than leaving a dead control', () => {
    render(
      <StaffProfileClient
        staff={makeStaff('finance')}
        viewerRole={'admin' as Role}
        facilities={FACILITIES}
      />,
    );

    expect(screen.getByRole('button', { name: /Change Facility/ })).toHaveAttribute(
      'title',
      'Finance is an organization-wide role, so it is not assigned to a facility.',
    );
  });

  it('does not open the modal when the target is org-wide', async () => {
    const user = userEvent.setup();
    render(
      <StaffProfileClient
        staff={makeStaff('hr')}
        viewerRole={'admin' as Role}
        facilities={FACILITIES}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Change Facility/ }));

    expect(screen.queryByRole('heading', { name: 'Change facility' })).not.toBeInTheDocument();
  });

  it('is hidden when there are no facilities to move to', () => {
    render(<StaffProfileClient staff={makeStaff()} viewerRole={'owner' as Role} facilities={[]} />);

    expect(screen.queryByRole('button', { name: /Change Facility/ })).not.toBeInTheDocument();
  });

  it('QA #21 / D-01: is hidden when the viewer has only ONE accessible facility — nowhere to reassign anyone to', () => {
    render(
      <StaffProfileClient
        staff={makeStaff()}
        viewerRole={'owner' as Role}
        facilities={[FACILITIES[0]]}
      />,
    );

    expect(screen.queryByRole('button', { name: /Change Facility/ })).not.toBeInTheDocument();
  });

  it('shows the role and facility chip from the design', () => {
    render(
      <StaffProfileClient
        staff={makeStaff()}
        viewerRole={'owner' as Role}
        facilities={FACILITIES}
      />,
    );

    expect(screen.getByText('Nurse, Akobo branch')).toBeInTheDocument();
  });
});
