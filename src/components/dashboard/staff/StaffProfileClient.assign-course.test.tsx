/**
 * Gating tests for the staff-profile "Assign Course" button. It follows the
 * `assignment.create` gate `assignCoursesToStaffMember` enforces — NOT the
 * `user.edit` roster gate next to it — so a Clinical Director may assign
 * training without holding any roster-edit rights, while a Finance viewer sees
 * nothing.
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

  it('is hidden for a clinical director — view-only on staff despite assignment.create', () => {
    renderFor('clinical_director');

    expect(screen.queryByRole('button', { name: /Assign Course/ })).not.toBeInTheDocument();
  });

  it('renders for HR, who holds both user.edit and assignment.create', () => {
    renderFor('hr');

    expect(screen.getByRole('button', { name: /Assign Course/ })).toBeInTheDocument();
  });

  it('is hidden for a viewer without assignment.create (finance)', () => {
    renderFor('finance');

    expect(screen.queryByRole('button', { name: /Assign Course/ })).not.toBeInTheDocument();
  });
});
