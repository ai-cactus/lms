/**
 * The course roster's "Assign Retake" hands the dialog the LEARNER's facility
 * zone, read from the roster's own server query, so the pre-filled due date is
 * 14 days from the learner's today rather than the admin's (BUG-12.3).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/actions/enrollment', () => ({ removeWorkerAssignment: vi.fn() }));
vi.mock('@/app/actions/course', () => ({ assignRetake: vi.fn() }));

// Render each action as a button, so selecting one is a plain click.
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({
    actions,
  }: {
    actions: { label: string; disabled?: boolean; onSelect: () => void }[];
  }) => (
    <div>
      {actions.map((a) => (
        <button key={a.label} type="button" disabled={a.disabled} onClick={a.onSelect}>
          {a.label}
        </button>
      ))}
    </div>
  ),
}));

import TrainingDetails from './TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

function courseWithLockedLearner(timezone: string | null): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    type: 'document',
    duration: 30,
    status: 'published',
    reviewRequired: false,
    lessons: [],
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    enrollments: [
      {
        id: 'enr-1',
        status: 'locked',
        organizationUser: {
          user: { fullName: 'Nina Nurse', email: 'nina@example.com' },
          facilities: timezone === null ? [] : [{ facility: { timezone } }],
        },
      },
    ],
  } as unknown as CourseWithRelations;
}

// 15:00 UTC on 28 Sept: still the 28th in Honolulu (UTC−10), already the 29th
// in Kiritimati (UTC+14).
const NOW = new Date('2026-09-28T15:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function openRetakeDialog(timezone: string | null) {
  render(<TrainingDetails course={courseWithLockedLearner(timezone)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign Retake' }));
  return screen.getByRole('button', { name: 'Retake due date' });
}

describe('TrainingDetails — retake due date follows the learner zone', () => {
  it("pre-fills 14 days from a UTC+14 learner's today, a day ahead of UTC−10", () => {
    expect(openRetakeDialog('Pacific/Kiritimati')).toHaveTextContent('October 13, 2026');
  });

  it("pre-fills 14 days from a UTC−10 learner's today", () => {
    expect(openRetakeDialog('Pacific/Honolulu')).toHaveTextContent('October 12, 2026');
  });

  it('falls back to America/New_York for a learner with no facility', () => {
    expect(openRetakeDialog(null)).toHaveTextContent('October 12, 2026');
  });
});
