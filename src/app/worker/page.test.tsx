/**
 * The learner dashboard reads its enrollments with a NESTED `course` include,
 * which the archive query extension cannot filter — so an archived course still
 * arrives here. Since archiving cancels a course for its learners
 * (Q-04/Q-05/Q-06), the row has to reach the list marked as cancelled, and the
 * welcome modal must stop offering a cancelled course as "your first course":
 * its Start button pushes straight into the player, which now refuses.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockGetWorkerCertificates, prismaMock } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetWorkerCertificates: vi.fn(),
  prismaMock: {
    enrollment: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/auth.worker', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/certificate', () => ({
  getWorkerCertificates: mockGetWorkerCertificates,
}));
vi.mock('@/components/worker/WorkerDashboardMetrics', () => ({ default: () => null }));
vi.mock('@/components/worker/WorkerAchievements', () => ({ default: () => null }));
vi.mock('@/components/worker/WorkerEmptyState', () => ({ default: () => null }));
vi.mock('@/components/worker/WorkerCourseList', () => ({
  default: ({ courses }: { courses: { id: string; courseArchived?: boolean }[] }) => (
    <div data-testid="course-list" data-archived={courses.map((c) => c.courseArchived).join(',')} />
  ),
}));
vi.mock('@/components/dashboard/learner/WorkerWelcomeModal', () => ({
  default: ({ courseCount, firstCourseId }: { courseCount: number; firstCourseId?: string }) => (
    <div data-testid="welcome-modal" data-count={courseCount} data-first={firstCourseId ?? ''} />
  ),
}));

import LearnerDashboard from './page';

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enr-1',
    courseId: 'course-1',
    status: 'assigned',
    progress: 0,
    score: null,
    dueAt: null,
    startedAt: new Date('2026-09-01T00:00:00Z'),
    retakeOf: null,
    certificate: null,
    quizAttempts: [],
    course: { title: 'Bloodborne Pathogens', duration: 30, quiz: null, archivedAt: null },
    ...overrides,
  };
}

function archived(overrides: Record<string, unknown> = {}) {
  return enrollment({
    course: {
      title: 'Bloodborne Pathogens',
      duration: 30,
      quiz: null,
      archivedAt: new Date('2026-09-23T00:00:00Z'),
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'worker-1', organizationUserId: 'ou-1' } });
  mockGetWorkerCertificates.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' });
});

describe('LearnerDashboard — archived courses', () => {
  it('flags an archived course to the list so it renders as cancelled', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([archived()]);

    render(await LearnerDashboard());

    expect(screen.getByTestId('course-list')).toHaveAttribute('data-archived', 'true');
  });

  it('leaves a live course unflagged', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([enrollment()]);

    render(await LearnerDashboard());

    expect(screen.getByTestId('course-list')).toHaveAttribute('data-archived', 'false');
  });

  it('never offers an archived course as the welcome modal\'s "first course"', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      archived({ id: 'enr-1', courseId: 'course-archived' }),
      enrollment({ id: 'enr-2', courseId: 'course-live' }),
    ]);

    render(await LearnerDashboard());

    const modal = screen.getByTestId('welcome-modal');
    expect(modal).toHaveAttribute('data-first', 'course-live');
    expect(modal).toHaveAttribute('data-count', '1');
  });

  it('keeps the welcome modal shut when every assigned course is cancelled', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([archived()]);

    render(await LearnerDashboard());

    const modal = screen.getByTestId('welcome-modal');
    expect(modal).toHaveAttribute('data-count', '0');
    expect(modal).toHaveAttribute('data-first', '');
  });
});
