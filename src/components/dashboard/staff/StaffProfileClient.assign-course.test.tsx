/**
 * Gating tests for the staff-profile "Assign Course" button.
 *
 * The gate is a CONJUNCTION: STAFF_PROFILE_ACTOR_ROLES (who may touch a staff
 * profile at all) AND `assignment.create`. Both halves are load-bearing and
 * neither may be dropped:
 *
 *  - without the actor list, Clinical Director — which holds all four
 *    `assignment.*` verbs — would get a mutating affordance on a profile the
 *    RBAC matrix makes it view-only on (rbac-staff-view-only.spec.ts).
 *  - without `assignment.create`, a role with roster rights but no assign verb
 *    would be offered a button the server action refuses.
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
  assignCoursesToStaffMember: vi.fn(),
}));
vi.mock('@/app/actions/course', () => ({
  getCourses: vi.fn().mockResolvedValue([]),
}));

const STAFF = {
  user: {
    id: 'ou-1',
    name: 'Frank Doe',
    email: 'frank@example.com',
    avatarUrl: null,
    role: 'nurse',
    jobTitle: 'Nurse',
    facilityName: 'Northside Clinic',
  },
  stats: { totalCourses: 0, completedCourses: 0, failedCourses: 0, activeCourses: 0 },
  enrollments: [],
};

function renderFor(role: string) {
  render(<StaffProfileClient staff={STAFF} viewerRole={role as Role} facilities={[]} />);
}

describe('StaffProfileClient — Assign Course button', () => {
  it('opens the assign-courses flow for a viewer with assignment.create', async () => {
    const user = userEvent.setup();
    renderFor('owner');

    await user.click(screen.getByRole('button', { name: /Assign Course/ }));

    expect(await screen.findByText('Assign Courses')).toBeInTheDocument();
    expect(
      screen.getByText('Choose the courses these staffs will be assigned to.'),
    ).toBeInTheDocument();
  });

  // ⛔ The regression this whole file exists to catch: simplifying the gate to a
  // bare `assignment.create` check surfaces this button for Clinical Director.
  it('is hidden for a clinical director — view-only on staff despite holding every assignment verb', () => {
    renderFor('clinical_director');

    expect(screen.queryByRole('button', { name: /Assign Course/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change Facility/ })).not.toBeInTheDocument();
  });

  // Q2: the supervisor's "U" — assigning courses — now reaches the profile.
  it('renders for a supervisor, who holds the profile actor list and assignment.create', () => {
    renderFor('supervisor');

    expect(screen.getByRole('button', { name: /Assign Course/ })).toBeInTheDocument();
  });

  it('renders for HR, who holds both the profile actor list and assignment.create', () => {
    renderFor('hr');

    expect(screen.getByRole('button', { name: /Assign Course/ })).toBeInTheDocument();
  });

  it('is hidden for a viewer without assignment.create (finance)', () => {
    renderFor('finance');

    expect(screen.queryByRole('button', { name: /Assign Course/ })).not.toBeInTheDocument();
  });
});
