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

  it("shows requestCourseRetry's refusal", async () => {
    mockRequestCourseRetry.mockResolvedValue({ success: false, refusedReason: REFUSAL });
    render(<CoursePreview course={course} mode="worker" enrollment={enrollment('failed')} />);

    await userEvent.click(screen.getByRole('button', { name: 'Request Retry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
  });

  it('shows nothing when the course starts', async () => {
    mockStartCourse.mockResolvedValue({ success: true });
    render(<CoursePreview course={course} mode="worker" enrollment={enrollment('enrolled')} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start Course' }));

    expect(mockPush).toHaveBeenCalledWith('/learn/course-1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
