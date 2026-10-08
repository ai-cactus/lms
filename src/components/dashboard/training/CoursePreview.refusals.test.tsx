/**
 * BUG-60: startCourse and requestCourseRetry RETURN their refusals, because a
 * thrown Server Action message is redacted in production. The worker start
 * button must show the returned reason rather than refresh in silence.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseWithRelations, EnrollmentWithRelations } from '@/types/course';

const { mockStartCourse, mockRequestCourseRetry, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockStartCourse: vi.fn(),
  mockRequestCourseRetry: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock('@/app/actions/course', () => ({ startCourse: mockStartCourse }));
vi.mock('@/app/actions/enrollment', () => ({ requestCourseRetry: mockRequestCourseRetry }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import CoursePreview from './CoursePreview';

const REFUSAL = 'Your session has ended. Please sign in again to continue.';

const course = {
  id: 'course-1',
  title: 'Infection Control',
  description: null,
  overview: null,
  type: 'document',
  duration: 30,
  status: 'published',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  objectives: [],
  skillLevel: null,
  previewVideoStorageUri: null,
  modules: [],
  quiz: null,
  lessons: [],
  creator: null,
} as unknown as CourseWithRelations;

function enrollment(status: string): EnrollmentWithRelations {
  return { id: 'enr-1', status, progress: 0 } as unknown as EnrollmentWithRelations;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoursePreview worker start button — returned refusals (BUG-60)', () => {
  it("shows startCourse's refusal and does not open the player", async () => {
    mockStartCourse.mockResolvedValue({ success: false, refusedReason: REFUSAL });
    render(<CoursePreview course={course} mode="worker" enrollment={enrollment('enrolled')} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start Course' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows requestCourseRetry's refusal on a locked enrolment", async () => {
    mockRequestCourseRetry.mockResolvedValue({ success: false, refusedReason: REFUSAL });
    render(<CoursePreview course={course} mode="worker" enrollment={enrollment('locked')} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
    expect(mockStartCourse).not.toHaveBeenCalled();
  });

  it('shows nothing when the course starts', async () => {
    mockStartCourse.mockResolvedValue({ success: true });
    render(<CoursePreview course={course} mode="worker" enrollment={enrollment('enrolled')} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start Course' }));

    expect(mockPush).toHaveBeenCalledWith('/learn/course-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

/**
 * Q-35: a locked learner cannot start the course (startCourse refuses it), so
 * the hero offers "Request retry" instead of a dead "Start Course".
 */
describe('CoursePreview worker button — locked enrolment (Q-35)', () => {
  function locked(retryRequestedAt: Date | null) {
    return {
      id: 'enr-1',
      status: 'locked',
      progress: 100,
      retryRequestedAt,
    } as unknown as EnrollmentWithRelations;
  }

  it('offers Request retry instead of Start Course, and records the request', async () => {
    mockRequestCourseRetry.mockResolvedValue({
      success: true,
      requestedAt: new Date().toISOString(),
    });
    render(<CoursePreview course={course} mode="worker" enrollment={locked(null)} />);

    expect(screen.queryByRole('button', { name: 'Start Course' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request retry' }));

    expect(mockRequestCourseRetry).toHaveBeenCalledWith('enr-1');
    expect(await screen.findByText('Retry requested')).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows Retry requested, with no button, while a recent request stands', () => {
    render(<CoursePreview course={course} mode="worker" enrollment={locked(new Date())} />);

    expect(screen.getByText('Retry requested')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request retry' })).not.toBeInTheDocument();
  });
});
