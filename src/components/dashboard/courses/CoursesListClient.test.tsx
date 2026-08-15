/**
 * Tests for CoursesListClient's registry-driven row action gating and the
 * Video/Reading Course tab split. `RowActionsMenu` is a generic, untested-elsewhere
 * Radix dropdown; per the established pattern (DocumentListClient.test.tsx),
 * it's stubbed to render its `actions` prop as plain buttons so assertions
 * target this component's own `buildRowActions` gating logic, not Radix.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RowAction } from '@/components/ui';
import type { CourseWithStats } from '@/types/course';
import type { Role } from '@/types/next-auth';

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

import CoursesListClient from './CoursesListClient';

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

  it('supervisor (read-only) resolves to ONLY "View Source Document" — no Assign/Duplicate/Rename/Delete', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="supervisor" />);

    const actions = actionsForRow();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryByRole('button', { name: 'Assign to staff' }),
    ).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
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
