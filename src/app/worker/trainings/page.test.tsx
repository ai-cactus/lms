/**
 * Companion to src/app/worker/page.test.tsx: the trainings list reads its
 * enrollments through the same nested `course` include, which the archive query
 * extension cannot filter, so it must carry the archived flag through to the
 * list for itself — the two pages build their rows independently.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { enrollment: { findMany: vi.fn() } },
}));

vi.mock('@/auth.worker', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/components/worker/WorkerTrainingList', () => ({
  default: ({ courses }: { courses: { courseArchived?: boolean }[] }) => (
    <div
      data-testid="training-list"
      data-archived={courses.map((c) => c.courseArchived).join(',')}
    />
  ),
}));

import WorkerTrainingsPage from './page';

function enrollment(archivedAt: Date | null) {
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
    course: {
      title: 'Bloodborne Pathogens',
      duration: 30,
      category: 'compliance',
      quiz: null,
      archivedAt,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'worker-1', organizationUserId: 'ou-1' } });
});

describe('WorkerTrainingsPage — archived courses', () => {
  it('flags an archived course so the list renders it as cancelled', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      enrollment(new Date('2026-09-23T00:00:00Z')),
    ]);

    render(await WorkerTrainingsPage());

    expect(screen.getByTestId('training-list')).toHaveAttribute('data-archived', 'true');
  });

  it('leaves a live course unflagged', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([enrollment(null)]);

    render(await WorkerTrainingsPage());

    expect(screen.getByTestId('training-list')).toHaveAttribute('data-archived', 'false');
  });
});
