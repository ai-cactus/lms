/**
 * Tests for CoursesListClient's registry-driven row action gating and the
 * Video/Slides tab split. `RowActionsMenu` is a generic, untested-elsewhere
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

describe('CoursesListClient — Video/Slides tabs', () => {
  it('shows both tabs with correct counts and filters rows by the active tab', async () => {
    const user = userEvent.setup();
    const courses = [
      makeCourse({ id: 'v1', title: 'Video Course', type: 'video' }),
      makeCourse({ id: 's1', title: 'Slides Course', type: 'text' }),
      makeCourse({ id: 's2', title: 'Second Slides Course', type: 'text' }),
    ];

    render(<CoursesListClient courses={courses} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('tab', { name: 'Video (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Slides (2)' })).toBeInTheDocument();

    // Opens on the tab that actually has courses when only one type is populated... here
    // both exist, so it defaults to Video per the "prefer Video" rule.
    expect(screen.getByText('Video Course')).toBeInTheDocument();
    expect(screen.queryByText('Slides Course')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Slides (2)' }));

    expect(screen.queryByText('Video Course')).not.toBeInTheDocument();
    expect(screen.getByText('Slides Course')).toBeInTheDocument();
    expect(screen.getByText('Second Slides Course')).toBeInTheDocument();
  });

  it('opens on the Slides tab when the org has only slides courses', () => {
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

describe('CoursesListClient — row action gating per role', () => {
  const course = makeCourse();

  function actionsForRow() {
    const row = screen.getByText('Infection Control').closest('tr')!;
    return within(row).getByTestId('row-actions');
  }

  it('owner sees every action: Assign, View Source Document, Duplicate, Rename, Delete', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
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

  it('supervisor sees NO row-actions menu at all for a forked course (no sourceDocumentId to view)', () => {
    const forkedCourse = makeCourse({ sourceDocumentId: null });
    render(<CoursesListClient courses={[forkedCourse]} hasBilling viewerRole="supervisor" />);

    const row = screen.getByText('Infection Control').closest('tr')!;
    expect(within(row).queryByTestId('row-actions')).not.toBeInTheDocument();
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

  it('never shows "View Source Document" for a forked course (no sourceDocumentId), even for a fully-permitted role', () => {
    const forkedCourse = makeCourse({ sourceDocumentId: null });
    render(<CoursesListClient courses={[forkedCourse]} hasBilling viewerRole="owner" />);

    const actions = actionsForRow();
    expect(
      within(actions).queryByRole('button', { name: 'View Source Document' }),
    ).not.toBeInTheDocument();
  });

  it('a worker-category role viewing this component (defensive) has no row actions', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole={'nurse' as Role} />);

    const row = screen.getByText('Infection Control').closest('tr')!;
    expect(within(row).queryByTestId('row-actions')).not.toBeInTheDocument();
  });
});

describe('CoursesListClient — create/prebuilt affordances gated on course.create', () => {
  it('shows Create Course + Prebuilt Courses buttons for owner', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('button', { name: /Create Course/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Prebuilt Courses/i })).toBeInTheDocument();
  });

  it('hides Create Course + Prebuilt Courses buttons for supervisor (read-only)', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="supervisor" />);

    expect(screen.queryByRole('button', { name: /Create Course/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prebuilt Courses/i })).not.toBeInTheDocument();
  });
});
