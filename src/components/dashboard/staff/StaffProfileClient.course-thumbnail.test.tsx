/**
 * The course-list redesign swapped the enrollments table's hand-rolled
 * icon-only thumbnail for the shared `CourseThumbnail`, keyed off the new
 * `enrollment.courseType` / `courseImage` fields. This pins that a reading
 * enrollment renders the dark tile and a video enrollment renders the frame,
 * rather than every row silently falling back to the old fixed icon.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StaffProfileClient from './StaffProfileClient';
import type { Role } from '@/types/next-auth';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

vi.mock('@/app/actions/certificate', () => ({
  getAdminWorkerCertificates: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/app/actions/staff', () => ({
  getEnrollmentQuizResult: vi.fn(),
  updateStaffDetails: vi.fn(),
  setStaffFacilities: vi.fn(),
  assignCoursesToStaffMember: vi.fn(),
}));
vi.mock('@/app/actions/course', () => ({
  getCourses: vi.fn().mockResolvedValue([]),
}));

const BASE_ENROLLMENT = {
  progress: 40,
  status: 'in_progress',
  score: 0,
  passingScore: 70,
  dueAt: null,
};

const STAFF = {
  user: {
    id: 'ou-1',
    name: 'Frank Doe',
    email: 'frank@example.com',
    avatarUrl: null,
    role: 'nurse',
    firstName: 'Target',
    lastName: 'User',
    facilityName: 'Northside Clinic',
  },
  stats: { totalCourses: 2, completedCourses: 0, failedCourses: 0, activeCourses: 2 },
  enrollments: [
    {
      ...BASE_ENROLLMENT,
      id: 'e1',
      courseId: 'c1',
      courseName: 'Reading Course',
      courseType: 'text',
      courseImage: null,
    },
    {
      ...BASE_ENROLLMENT,
      id: 'e2',
      courseId: 'c2',
      courseName: 'Video Course',
      courseType: 'video',
      courseImage: 'https://x/video.png',
    },
  ],
};

describe('StaffProfileClient — enrollment thumbnail per course type', () => {
  it('renders the dark reading tile for a text enrollment and the video frame for a video enrollment', () => {
    render(
      <StaffProfileClient
        staff={STAFF}
        viewerRole={'owner' as Role}
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
      />,
    );

    const readingRow = screen.getByText('Reading Course').closest('tr')!;
    expect(readingRow.querySelector('[class*="bg-[#1c213d]"]')).not.toBeNull();
    expect(readingRow.querySelector('img')).toBeNull();

    const videoRow = screen.getByText('Video Course').closest('tr')!;
    expect(videoRow.querySelector('img')).not.toBeNull();
    expect(videoRow.querySelector('[class*="bg-[#1c213d]"]')).toBeNull();
  });
});
