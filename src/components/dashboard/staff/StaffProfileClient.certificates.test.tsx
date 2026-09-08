/**
 * The "Certificates Earned" status column badged every row "Approved" — a
 * hardcoded literal never derived from any status. A Certificate row only
 * exists once it has been issued, so the label now reads "Issued". Regression
 * pin so the corrected label cannot silently regress back to "Approved".
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StaffProfileClient from './StaffProfileClient';
import type { Role } from '@/types/next-auth';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

const mockGetAdminWorkerCertificates = vi.fn();
vi.mock('@/app/actions/certificate', () => ({
  getAdminWorkerCertificates: (...args: unknown[]) => mockGetAdminWorkerCertificates(...args),
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

function renderProfile() {
  render(<StaffProfileClient staff={STAFF} viewerRole={'owner' as Role} facilities={[]} />);
}

describe('StaffProfileClient — certificate status badge', () => {
  it('badges an earned certificate "Issued", never the old "Approved" literal', async () => {
    mockGetAdminWorkerCertificates.mockResolvedValue([
      {
        id: 'cert-1',
        issuedAt: new Date('2026-01-15T12:00:00Z'),
        course: { title: 'Bloodborne Pathogens' },
      },
    ]);

    renderProfile();

    expect(await screen.findByText('Issued')).toBeInTheDocument();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
  });
});
