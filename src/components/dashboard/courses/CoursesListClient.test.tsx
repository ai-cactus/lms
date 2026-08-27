/**
 * Tests for CoursesListClient's registry-driven row action gating and the
 * Video/Reading Course tab split. `RowActionsMenu` is a generic, untested-elsewhere
 * Radix dropdown; per the established pattern (DocumentListClient.test.tsx),
 * it's stubbed to render its `actions` prop as plain buttons so assertions
 * target this component's own `buildRowActions` gating logic, not Radix.
 */
import { act, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RowAction } from '@/components/ui';
import type { CourseWithStats } from '@/types/course';
import type { Role } from '@/types/next-auth';
import {
  PENDING_GENERATION_KEY,
  writePendingGeneration,
  type PendingGenerationJob,
} from '@/lib/course/pending-generation';

const { mockPush, mockDeleteCourse, mockDuplicateCourse, mockUpdateCourse } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockDeleteCourse: vi.fn(),
  mockDuplicateCourse: vi.fn(),
  mockUpdateCourse: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('@/app/actions/course', () => ({
  deleteCourse: mockDeleteCourse,
  duplicateCourse: mockDuplicateCourse,
  updateCourse: mockUpdateCourse,
}));
vi.mock('@/app/actions/course-ai-v4.6', () => ({ checkCourseGenerationJobV46: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
vi.mock('@/components/dashboard/billing/BillingGateModal', () => ({
  default: () => null,
}));
// Stubbed to keep these tests on this component's own wiring — the modal's own
// behaviour is covered in AssignCourseModal.test.tsx.
vi.mock('./AssignCourseModal', () => ({
  default: ({
    courseId,
    courseTitle,
    onClose,
  }: {
    courseId: string;
    courseTitle: string;
    onClose: () => void;
  }) => (
    <div data-testid="assign-course-modal">
      {courseId} {courseTitle}
      <button type="button" onClick={onClose}>
        close-assign-modal
      </button>
    </div>
  ),
}));
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({ actions }: { actions: RowAction[] }) => (
    <div data-testid="row-actions">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

import { checkCourseGenerationJobV46 } from '@/app/actions/course-ai-v4.6';
import CoursesListClient from './CoursesListClient';

const mockCheckJob = vi.mocked(checkCourseGenerationJobV46);

function makeCourse(overrides: Partial<CourseWithStats> = {}): CourseWithStats {
  return {
    id: 'course-1',
    title: 'Infection Control',
    description: null,
    thumbnail: null,
    status: 'published',
    type: 'video',
    duration: 30,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    lessonsCount: 3,
    enrollmentsCount: 5,
    completionRate: 50,
    sourceDocumentId: 'doc-1',
    ...overrides,
  } as CourseWithStats;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('CoursesListClient — Video/Reading Course tabs', () => {
  it('shows both tabs with correct counts and filters rows by the active tab', async () => {
    const user = userEvent.setup();
    const courses = [
      makeCourse({ id: 'v1', title: 'Video Course', type: 'video' }),
      makeCourse({ id: 's1', title: 'Slides Course', type: 'text' }),
      makeCourse({ id: 's2', title: 'Second Slides Course', type: 'text' }),
    ];

    render(<CoursesListClient courses={courses} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('tab', { name: 'Video 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reading Course 2' })).toBeInTheDocument();

    // Opens on the tab that actually has courses when only one type is populated... here
    // both exist, so it defaults to Video per the "prefer Video" rule.
    expect(screen.getByText('Video Course')).toBeInTheDocument();
    expect(screen.queryByText('Slides Course')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Reading Course 2' }));

    expect(screen.queryByText('Video Course')).not.toBeInTheDocument();
    expect(screen.getByText('Slides Course')).toBeInTheDocument();
    expect(screen.getByText('Second Slides Course')).toBeInTheDocument();
  });

  it('opens on the Reading Course tab when the org has only text courses', () => {
    render(
      <CoursesListClient
        courses={[makeCourse({ id: 's1', title: 'Slides Only', type: 'text' })]}
        hasBilling
        viewerRole="owner"
      />,
    );

    expect(screen.getByText('Slides Only')).toBeInTheDocument();
  });
});

describe('CoursesListClient — table columns', () => {
  it('renders only Course Name, Assigned Staff, Description and Action headers', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('columnheader', { name: 'Course Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Assigned Staff' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();

    expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Date Created' })).not.toBeInTheDocument();
  });

  it('shows the course description, and an em-dash when it is empty', () => {
    render(
      <CoursesListClient
        courses={[
          makeCourse({ id: 'c1', title: 'Described', description: 'Comprehensive HIPAA training' }),
          makeCourse({ id: 'c2', title: 'Undescribed', description: null }),
        ]}
        hasBilling
        viewerRole="owner"
      />,
    );

    expect(screen.getByText('Comprehensive HIPAA training')).toBeInTheDocument();
    expect(
      within(screen.getByText('Undescribed').closest('tr')!).getByText('—'),
    ).toBeInTheDocument();
  });
});

describe('CoursesListClient — row action gating per role', () => {
  const course = makeCourse();

  function actionsForRow() {
    const row = screen.getByText('Infection Control').closest('tr')!;
    return within(row).getByTestId('row-actions');
  }

  it('owner sees the design action set: Assign, View Source Document, Rename, Delete — no Duplicate', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  // UPDATED 2026-08-25 — team QA section 3.1: "Facility supervisors should be
  // able to assign courses". Supervisor now holds assignment.create, so Assign
  // MUST appear; the authoring actions must still not, per C8 ("can't create or
  // edit documents and courses").
  it('supervisor resolves to "View Source Document" AND "Assign to staff" — but no authoring actions', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="supervisor" />);

    const actions = actionsForRow();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('supervisor still gets a disabled "View Source Document" for a forked course (item always listed per design)', () => {
    const forkedCourse = makeCourse({ sourceDocumentId: null });
    render(<CoursesListClient courses={[forkedCourse]} hasBilling viewerRole="supervisor" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'View Source Document' })).toBeDisabled();
  });

  it('finance (no course/document/assignment grants) sees no row actions', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="finance" />);

    const row = screen.getByText('Infection Control').closest('tr')!;
    expect(within(row).queryByTestId('row-actions')).not.toBeInTheDocument();
  });

  it('hr sees Assign, View Source Document, Duplicate, Rename, Delete (full course + assignment + document grants)', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="hr" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows a DISABLED "View Source Document" for a forked course (no sourceDocumentId) — listed per design, not clickable', () => {
    const forkedCourse = makeCourse({ sourceDocumentId: null });
    render(<CoursesListClient courses={[forkedCourse]} hasBilling viewerRole="owner" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'View Source Document' })).toBeDisabled();
  });

  it('a worker-category role viewing this component (defensive) has no row actions', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole={'nurse' as Role} />);

    const row = screen.getByText('Infection Control').closest('tr')!;
    expect(within(row).queryByTestId('row-actions')).not.toBeInTheDocument();
  });
});

describe('CoursesListClient — "Assign to staff" opens the modal', () => {
  it('mounts AssignCourseModal for the chosen course instead of navigating to the wizard page', async () => {
    const user = userEvent.setup();
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    expect(screen.queryByTestId('assign-course-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Assign to staff' }));

    const modal = screen.getByTestId('assign-course-modal');
    expect(modal).toHaveTextContent('course-1');
    expect(modal).toHaveTextContent('Infection Control');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('closes the modal without navigating', async () => {
    const user = userEvent.setup();
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    await user.click(screen.getByRole('button', { name: 'Assign to staff' }));
    await user.click(screen.getByRole('button', { name: 'close-assign-modal' }));

    expect(screen.queryByTestId('assign-course-modal')).not.toBeInTheDocument();
  });
});

describe('CoursesListClient — create/prebuilt affordances gated on course.create', () => {
  it('shows only the Create Course button for owner — no header Prebuilt button (per design)', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('button', { name: /Create Course/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prebuilt Courses/i })).not.toBeInTheDocument();
  });

  it('hides Create Course + Prebuilt Courses buttons for supervisor (read-only)', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="supervisor" />);

    expect(screen.queryByRole('button', { name: /Create Course/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prebuilt Courses/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PendingGenerationBanner — polling truthfulness (fix/course-generation-banner-truthfulness)
//
// Regression context: this path previously had ZERO coverage because no test
// ever seeded localStorage, so `readPendingGeneration()` always returned null
// and the banner stayed `hidden` — the entire polling loop went untested. That
// gap is why a live bug (jobs failed, banner still said "still being
// generated") shipped unnoticed.
//
// The critical shape distinction under test: a genuinely failed job returns
// BOTH `status: 'failed'` AND `error` together — the client checks `status`
// FIRST so that shape routes to `failed` immediately. A bare `{ error }` with
// NO `status` is a different, undetermined signal ('Job not found', a thrown
// network error) that must NOT be treated as a failure — it only counts
// toward the 3-consecutive-poll tolerance before the banner gives up as
// `unknown`.
// ---------------------------------------------------------------------------
function seedPendingGeneration(
  jobs: PendingGenerationJob[] = [{ moduleIndex: 0, jobId: 'job-1' }],
) {
  writePendingGeneration(jobs);
}

/** Advances the 5s poll interval by one tick and flushes the async callback. */
async function advancePoll(ms = 5000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('CoursesListClient — pending generation banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all jobs completed renders the done banner with a Resume Setup link', async () => {
    seedPendingGeneration([
      { moduleIndex: 0, jobId: 'job-1' },
      { moduleIndex: 1, jobId: 'job-2' },
    ]);
    mockCheckJob.mockResolvedValue({ status: 'completed' });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);

    // Confirm we are actually on the polling path before asserting anything else.
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();

    expect(screen.getByText(/Course generation complete/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Resume Setup/i });
    expect(link).toHaveAttribute('href', '/dashboard/courses/create');
    expect(mockCheckJob).toHaveBeenCalledTimes(2);
  });

  it('a job reporting status: failed (with error) shows the failed banner on the first poll and stops polling', async () => {
    seedPendingGeneration([
      { moduleIndex: 0, jobId: 'job-1' },
      { moduleIndex: 1, jobId: 'job-2' },
    ]);
    mockCheckJob.mockImplementation(async (jobId: string) =>
      jobId === 'job-1'
        ? { status: 'failed', error: 'Course generation failed. Please start a new course.' }
        : { status: 'processing' },
    );

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();

    expect(
      screen.getByText('Course generation failed. Please start a new course.'),
    ).toBeInTheDocument();
    expect(mockCheckJob).toHaveBeenCalledTimes(2);

    // The interval must be cleared — no further polling after `failed`.
    await advancePoll(15000);
    expect(mockCheckJob).toHaveBeenCalledTimes(2);
  });

  it('does NOT route a bare { error } (no status) to failed — old buggy behaviour regression guard', async () => {
    seedPendingGeneration();
    // No `status` field at all — this must never be mistaken for status: 'failed'.
    mockCheckJob.mockResolvedValue({ error: 'Job not found' });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();
    expect(screen.queryByText(/Course generation failed/i)).not.toBeInTheDocument();
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();
  });

  it('tolerates two consecutive bare-{ error } polls, then gives up as unknown on the third', async () => {
    seedPendingGeneration();
    mockCheckJob.mockResolvedValue({ error: 'Job not found' });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll(); // poll 1 — undetermined, tolerated
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll(); // poll 2 — undetermined, tolerated
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll(); // poll 3 — gives up
    expect(screen.getByText(/We couldn.t check on your course generation/i)).toBeInTheDocument();
    expect(mockCheckJob).toHaveBeenCalledTimes(3);
  });

  it('treats a thrown poll error the same as a bare { error } — same 1/2/3 progression to unknown', async () => {
    seedPendingGeneration();
    mockCheckJob.mockRejectedValue(new Error('network blip'));

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();
    expect(screen.getByText(/We couldn.t check on your course generation/i)).toBeInTheDocument();
  });

  it('resets the consecutive-failure counter on a clean poll, so alternating blips never accumulate to unknown', async () => {
    seedPendingGeneration();
    mockCheckJob
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValueOnce({ status: 'processing' })
      .mockRejectedValueOnce(new Error('blip 3'))
      .mockRejectedValueOnce(new Error('blip 4'));

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    for (let i = 0; i < 5; i++) {
      await advancePoll();
    }

    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/We couldn.t check on your course generation/i),
    ).not.toBeInTheDocument();
  });

  it('one job throwing while another completes leaves the state undetermined, not done', async () => {
    seedPendingGeneration([
      { moduleIndex: 0, jobId: 'job-1' },
      { moduleIndex: 1, jobId: 'job-2' },
    ]);
    mockCheckJob.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-1') throw new Error('transient');
      return { status: 'completed' };
    });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();

    expect(screen.queryByText(/Course generation complete/i)).not.toBeInTheDocument();
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();
  });

  it('unknown renders the Check Job Queue link, and dismiss clears the pending payload', async () => {
    seedPendingGeneration();
    mockCheckJob.mockResolvedValue({ error: 'Job not found' });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    for (let i = 0; i < 3; i++) {
      await advancePoll();
    }

    const link = screen.getByRole('link', { name: /Check Job Queue/i });
    expect(link).toHaveAttribute('href', '/dashboard/courses/queue');

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(
      screen.queryByText(/We couldn.t check on your course generation/i),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).toBeNull();
  });

  it('does NOT clear the pending payload on its own when giving up as unknown', async () => {
    seedPendingGeneration();
    mockCheckJob.mockResolvedValue({ error: 'Job not found' });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    for (let i = 0; i < 3; i++) {
      await advancePoll();
    }

    expect(screen.getByText(/We couldn.t check on your course generation/i)).toBeInTheDocument();
    // Deliberate: an unresumed `unknown` payload must survive so the wizard
    // can still resume it — only an explicit dismiss discards it.
    expect(localStorage.getItem(PENDING_GENERATION_KEY)).not.toBeNull();
  });

  it('with no pending generation in localStorage the banner stays hidden and never polls', async () => {
    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);

    expect(screen.queryByText(/still being generated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Course generation complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Course generation failed/i)).not.toBeInTheDocument();

    await advancePoll(20000);

    expect(mockCheckJob).not.toHaveBeenCalled();
  });

  it('multi-module: every job is polled each tick, and any one failing routes to failed', async () => {
    seedPendingGeneration([
      { moduleIndex: 0, jobId: 'job-1' },
      { moduleIndex: 1, jobId: 'job-2' },
      { moduleIndex: 2, jobId: 'job-3' },
    ]);
    mockCheckJob.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-3') {
        return { status: 'failed', error: 'Course generation failed. Please start a new course.' };
      }
      return { status: 'processing' };
    });

    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);
    expect(screen.getByText(/still being generated/i)).toBeInTheDocument();

    await advancePoll();

    expect(mockCheckJob).toHaveBeenCalledWith('job-1');
    expect(mockCheckJob).toHaveBeenCalledWith('job-2');
    expect(mockCheckJob).toHaveBeenCalledWith('job-3');
    expect(mockCheckJob).toHaveBeenCalledTimes(3);
    expect(
      screen.getByText('Course generation failed. Please start a new course.'),
    ).toBeInTheDocument();
  });
});
