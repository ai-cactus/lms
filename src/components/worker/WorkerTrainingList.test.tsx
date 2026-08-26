/**
 * Regression test for Issue #2: both "Start Course" and "Continue" used to
 * route straight to the player at `/learn/[id]`, skipping the course preview.
 * Both entry points now land on `/worker/courses/[id]` (the preview), which
 * itself starts the player when the learner clicks through — see
 * worker-trainings-preview-flow.spec.ts for the full e2e chain into `/learn`.
 */
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

import WorkerTrainingList from './WorkerTrainingList';

function baseCourse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    title: 'Bloodborne Pathogens',
    status: 'assigned',
    progress: 0,
    ...overrides,
  };
}

describe('WorkerTrainingList — routes through the course preview, never straight to /learn', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('"Start Course" navigates to /worker/courses/[id], not /learn/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'assigned', progress: 0 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Course' }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/learn/'));
  });

  it('"Continue" (an in-progress course) also navigates to /worker/courses/[id], not /learn/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'in_progress', progress: 40 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/learn/'));
  });

  it('"Retry" (a failed course) also navigates to /worker/courses/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'failed', progress: 100 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
  });

  it('"View Result" (a completed course) navigates to /worker/courses/[id] as well', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'completed', progress: 100 })]} />);

    // Completed courses render under the "Completed" tab — its accessible
    // name includes the count badge (e.g. "Completed 1"), so match loosely.
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
  });

  it('a locked course is not clickable and never navigates anywhere', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'locked', progress: 0 })]} />);

    const button = screen.getByRole('button', { name: 'Locked' });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(mockPush).not.toHaveBeenCalled();
  });
});
