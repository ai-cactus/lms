/**
 * Regression test for Issue #2: both "Start" and "Continue" used to route
 * straight to the player at `/learn/[id]`, skipping the course preview. Both
 * entry points now land on `/worker/courses/[id]` (the preview), which itself
 * starts the player when the learner clicks through — see
 * worker-trainings-preview-flow.spec.ts for the full e2e chain into `/learn`.
 *
 * The page opens on the "My Courses" tab, which renders every enrollment
 * through WorkerCourseList; the "Completed" tab keeps its own card list.
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

  it('"Start" navigates to /worker/courses/[id], not /learn/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'assigned', progress: 0 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/learn/'));
  });

  it('"Continue" (an in-progress course) also navigates to /worker/courses/[id], not /learn/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'in_progress', progress: 40 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/learn/'));
  });

  it('"Retry" (a failed course) also navigates to /worker/courses/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'failed', progress: 100 })]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
  });

  it('"View Result" on the Completed tab navigates to /worker/courses/[id]', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'completed', progress: 100 })]} />);

    // The tab's accessible name includes the count badge (e.g. "Completed 1"),
    // so match loosely.
    fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View Result' }));

    expect(mockPush).toHaveBeenCalledWith('/worker/courses/course-1');
  });

  it('a locked course offers no start action and never navigates anywhere', () => {
    render(<WorkerTrainingList courses={[baseCourse({ status: 'locked', progress: 0 })]} />);

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    fireEvent.click(screen.getByText('Bloodborne Pathogens'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('WorkerTrainingList — tabs', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('offers only "My Courses" and "Completed" — the Active tab is gone', () => {
    render(
      <WorkerTrainingList
        courses={[
          baseCourse({ id: 'course-1', status: 'in_progress', progress: 40 }),
          baseCourse({ id: 'course-2', title: 'Fire Safety', status: 'completed', progress: 100 }),
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Active/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^My Courses/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Completed/ })).toBeInTheDocument();
  });

  it('opens on "My Courses", listing active and completed enrollments together', () => {
    render(
      <WorkerTrainingList
        courses={[
          baseCourse({ id: 'course-1', status: 'in_progress', progress: 40 }),
          baseCourse({ id: 'course-2', title: 'Fire Safety', status: 'completed', progress: 100 }),
        ]}
      />,
    );

    expect(screen.getByText('Bloodborne Pathogens')).toBeInTheDocument();
    expect(screen.getByText('Fire Safety')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^My Courses/ })).toHaveTextContent('2');
  });
});
