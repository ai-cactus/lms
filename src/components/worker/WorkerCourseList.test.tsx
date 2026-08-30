/**
 * Phase 3 QA regression tests for WorkerCourseList's "Attempt N" badge line.
 *
 * Bug fixed: the dashboard always showed "Attempt N" beneath the In
 * Progress/Assigned badge once a course was started, even after the worker
 * had already passed their latest completed attempt and only needed to
 * attest — a stale, misleading hint. Fixed to suppress the line once the
 * latest completed attempt's score meets/exceeds the course's passingScore.
 * A failed completed attempt (or an in-progress draft) must still show the
 * hint, with attemptCount/attemptCount+1 semantics unchanged.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import WorkerCourseList from './WorkerCourseList';

function baseCourse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    title: 'Bloodborne Pathogens',
    status: 'in_progress',
    progress: 40,
    enrollmentId: 'enr-1',
    ...overrides,
  };
}

describe('WorkerCourseList — Attempt N badge suppression on pass', () => {
  it('hides the Attempt line when the latest completed attempt passed', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 1, timeTaken: 120, score: 85 }],
          }),
        ]}
      />,
    );

    expect(screen.queryByText(/^Attempt/)).not.toBeInTheDocument();
  });

  it('shows "Attempt 2" when the latest completed attempt failed', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 1, timeTaken: 120, score: 50 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });

  it('shows the draft attemptCount as-is when the latest attempt is in progress (timeTaken null)', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 2, timeTaken: null, score: 0 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });

  it('still shows the Attempt line when passingScore is unknown (null), even if the score was high', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            passingScore: null,
            quizAttempts: [{ id: 'a1', attemptCount: 1, timeTaken: 120, score: 100 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });

  it('shows "Attempt 1" for a started course with no quizAttempts recorded yet', () => {
    render(<WorkerCourseList courses={[baseCourse({ quizAttempts: [] })]} />);

    // isStarted && quizAttempts (truthy, even if empty) renders the line with default attemptNumber 1
    expect(screen.getByText('Attempt 1')).toBeInTheDocument();
  });

  it('omits the Attempt line entirely for an assigned (not started) course', () => {
    render(
      <WorkerCourseList
        courses={[baseCourse({ status: 'assigned', progress: 0, quizAttempts: undefined })]}
      />,
    );

    expect(screen.queryByText(/^Attempt/)).not.toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('does not show the Attempt line for a completed (non-in-progress) course status', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            status: 'completed',
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 1, timeTaken: 120, score: 90 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByText(/^Attempt/)).not.toBeInTheDocument();
  });
});

/**
 * Bug A: the learner table had no Action column at all, so a worker holding an
 * admin-assigned retake (a NEW enrollment with `retakeOf` set) had no way to
 * start it, and a `locked` learner was offered nothing that named what happens
 * next. A `locked` row must never offer Retry — attempts are exhausted and only
 * an admin's assignRetake can reopen it.
 */
describe('WorkerCourseList — Action column', () => {
  it('offers Start for an assigned course that is not a retake', () => {
    render(<WorkerCourseList courses={[baseCourse({ status: 'assigned', progress: 0 })]} />);

    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('offers Continue for an in-progress course', () => {
    render(<WorkerCourseList courses={[baseCourse({ status: 'in_progress', progress: 40 })]} />);

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('offers Retry when the latest completed attempt failed and attempts remain', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            status: 'in_progress',
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 1, timeTaken: 120, score: 40 }],
          }),
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('offers Retake and the "Retake required" badge for an assigned retake enrollment', () => {
    render(
      <WorkerCourseList
        courses={[baseCourse({ status: 'enrolled', progress: 0, retakeOf: 'enr-old' })]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument();
    expect(screen.getByText('Retake required')).toBeInTheDocument();
  });

  it('offers NO action link on a locked row — never Retry — and says an admin retake is awaited', () => {
    render(
      <WorkerCourseList
        courses={[
          baseCourse({
            status: 'locked',
            progress: 100,
            passingScore: 70,
            quizAttempts: [{ id: 'a1', attemptCount: 3, timeTaken: 120, score: 40 }],
          }),
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retake' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.getByText('Awaiting admin retake')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Actions for/ })).toBeInTheDocument();
  });

  it('offers View for a completed course', () => {
    render(<WorkerCourseList courses={[baseCourse({ status: 'attested', progress: 100 })]} />);

    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('renders no kebab for a freshly assigned course (nothing to offer yet)', () => {
    render(<WorkerCourseList courses={[baseCourse({ status: 'assigned', progress: 0 })]} />);

    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });
});
