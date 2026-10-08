/**
 * Q-35: on the learner's review screen for a locked enrolment, the one action
 * left is asking an admin for a retake. The admin views that reuse this screen
 * never pass `retryRequest`, so they never see it.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/actions/enrollment', () => ({ requestCourseRetry: vi.fn() }));

import QuizResults from './QuizResults';

const DATA = {
  courseName: 'Infection Control',
  score: 40,
  answered: 5,
  correct: 2,
  wrong: 3,
  time: 120,
  attemptsUsed: 3,
  allowedAttempts: 3,
  questions: [],
};

describe('QuizResults — Request retry (Q-35)', () => {
  it('offers Request retry, and no Retake Quiz, on a locked learner result', () => {
    render(
      <QuizResults
        courseId="course-1"
        enrollmentId="enr-1"
        passed={false}
        data={DATA}
        retryRequest={{ enrollmentId: 'enr-1', retryRequestedAt: null }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Request retry' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retake Quiz' })).not.toBeInTheDocument();
  });

  it('shows Retry requested while a recent request stands', () => {
    render(
      <QuizResults
        courseId="course-1"
        enrollmentId="enr-1"
        passed={false}
        data={DATA}
        retryRequest={{ enrollmentId: 'enr-1', retryRequestedAt: new Date().toISOString() }}
      />,
    );

    expect(screen.getByText('Retry requested')).toBeInTheDocument();
  });

  it('shows nothing of the kind without retryRequest (the admin views)', () => {
    render(<QuizResults courseId="course-1" enrollmentId="enr-1" passed={false} data={DATA} />);

    expect(screen.queryByRole('button', { name: 'Request retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('Retry requested')).not.toBeInTheDocument();
  });

  it('hides it with the other actions once the enrolment is signed', () => {
    render(
      <QuizResults
        courseId="course-1"
        enrollmentId="enr-1"
        passed={false}
        hideActions
        data={DATA}
        retryRequest={{ enrollmentId: 'enr-1', retryRequestedAt: null }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Request retry' })).not.toBeInTheDocument();
  });
});
