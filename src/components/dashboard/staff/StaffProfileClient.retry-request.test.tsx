/**
 * Q-35 on the staff profile: a locked row whose learner asked for a retake says
 * so, and the retry-request notice's deep link (`?retake=<enrollmentId>`) opens
 * Assign Retake on arrival — once, and only for a locked row of this member that
 * has not been retaken.
 */
import { render, screen, within } from '@testing-library/react';
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
  updateStaffDetails: vi.fn(),
  setStaffFacilities: vi.fn(),
  assignCoursesToStaffMember: vi.fn(),
}));
vi.mock('@/app/actions/course', () => ({
  getCourses: vi.fn().mockResolvedValue([]),
  assignRetake: vi.fn(),
}));

function lockedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-locked',
    courseId: 'course-1',
    courseName: 'Infection Control',
    progress: 100,
    status: 'locked',
    score: 40,
    passingScore: 70,
    dueAt: null,
    retryRequestedAt: null,
    hasSuccessor: false,
    ...overrides,
  };
}

function renderProfile(
  enrollments: ReturnType<typeof lockedRow>[],
  openRetakeForEnrollmentId: string | null = null,
) {
  return render(
    <StaffProfileClient
      staff={{
        user: {
          id: 'ou-1',
          name: 'Ada Worker',
          email: 'ada@example.com',
          avatarUrl: null,
          role: 'nurse',
          firstName: 'Ada',
          lastName: 'Worker',
          facilityName: 'Northside Clinic',
          timeZone: 'UTC',
        },
        stats: { totalCourses: 1, completedCourses: 0, failedCourses: 1, activeCourses: 0 },
        enrollments,
      }}
      viewerRole={'owner' as Role}
      viewerOrganizationUserId="ou-viewer"
      facilities={[]}
      openRetakeForEnrollmentId={openRetakeForEnrollmentId}
    />,
  );
}

describe('StaffProfileClient — retry requests (Q-35)', () => {
  it('labels a pending request under Locked with its date', () => {
    renderProfile([lockedRow({ retryRequestedAt: '2026-10-05T15:00:00.000Z' })]);

    expect(screen.getByText('Retry requested Oct 5, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Limit reached')).not.toBeInTheDocument();
  });

  it('keeps "Limit reached" when the learner has not asked', () => {
    renderProfile([lockedRow()]);

    expect(screen.getByText('Limit reached')).toBeInTheDocument();
  });

  it('withdraws the grant once a retake exists, and says so', () => {
    renderProfile([
      lockedRow({ retryRequestedAt: '2026-10-05T15:00:00.000Z', hasSuccessor: true }),
    ]);

    expect(screen.getByText('Retake assigned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('opens Assign Retake on arrival from the notice deep link', () => {
    renderProfile([lockedRow({ retryRequestedAt: '2026-10-05T15:00:00.000Z' })], 'enr-locked');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Assign Retake', { selector: 'h2' })).toBeInTheDocument();
    expect(within(dialog).getByText('Infection Control')).toBeInTheDocument();
  });

  it('opens it only once — closing it does not bring it back', async () => {
    const user = userEvent.setup();
    const { rerender } = renderProfile([lockedRow()], 'enr-locked');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <StaffProfileClient
        staff={{
          user: {
            id: 'ou-1',
            name: 'Ada Worker',
            email: 'ada@example.com',
            avatarUrl: null,
            role: 'nurse',
            firstName: 'Ada',
            lastName: 'Worker',
            facilityName: 'Northside Clinic',
            timeZone: 'UTC',
          },
          stats: { totalCourses: 1, completedCourses: 0, failedCourses: 1, activeCourses: 0 },
          enrollments: [lockedRow()],
        }}
        viewerRole={'owner' as Role}
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
        openRetakeForEnrollmentId="enr-locked"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['an id that is not on this profile', [lockedRow()], 'enr-elsewhere'],
    ['a row that is not locked', [lockedRow({ status: 'in_progress' })], 'enr-locked'],
    ['a row already retaken', [lockedRow({ hasSuccessor: true })], 'enr-locked'],
  ])('does not open for %s', (_label, enrollments, target) => {
    renderProfile(enrollments, target);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
