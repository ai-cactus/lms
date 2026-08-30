/**
 * Thin wiring test: this page now delegates access entirely to
 * `loadCourseDetail` (its retry/rethrow contract is fully covered in
 * src/lib/course/load-course-detail.test.ts) — here we only pin that the page
 * calls notFound() on a null result and renders on a real course, replacing
 * the old inline try/catch/try/catch.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadCourseDetail, mockNotFound, mockAuth } = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockAuth: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/components/dashboard/training/TrainingDetails', () => ({
  default: ({ canWithdrawAssignments }: { canWithdrawAssignments?: boolean }) => (
    <div data-testid="training-details" data-can-withdraw={String(!!canWithdrawAssignments)} />
  ),
}));

import CourseDetailsPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'u-1', organizationUserId: 'ou-1', organizationId: 'org-1', role: 'owner' },
  });
});

describe('CourseDetailsPage', () => {
  it('calls notFound() when loadCourseDetail resolves null', async () => {
    mockLoadCourseDetail.mockResolvedValue(null);

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders TrainingDetails when a course is returned', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    const element = await CourseDetailsPage({ params });
    render(element);

    expect(screen.getByTestId('training-details')).toBeInTheDocument();
  });

  it('a non-access failure from loadCourseDetail propagates rather than becoming notFound()', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockLoadCourseDetail.mockRejectedValue(dbError);

    await expect(CourseDetailsPage({ params })).rejects.toBe(dbError);
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});

/**
 * The withdraw control's gate is computed HERE, mirroring
 * removeWorkerAssignment's own course-creator rule, so the action is never
 * offered where it would be refused.
 */
describe('CourseDetailsPage — withdraw gate', () => {
  it('allows withdrawing when the viewer created the course', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  it('withholds it when someone else created the course — reading a roster is not withdrawing from it', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-other' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'false');
  });

  it('withholds it when there is no session membership', async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'false');
  });
});
