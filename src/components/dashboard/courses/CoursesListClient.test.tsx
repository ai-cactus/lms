/**
 * Tests for CoursesListClient's registry-driven row action gating, the
 * Video/Reading Course tab split, per-tab columns, and the per-tab illustrated
 * empty state introduced by the Figma redesign. `RowActionsMenu` is a
 * generic, untested-elsewhere Radix dropdown; per the established pattern
 * (DocumentListClient.test.tsx), it's stubbed to render its `actions` prop as
 * plain buttons so assertions target this component's own `buildRowActions`
 * gating logic, not Radix.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RowAction } from '@/components/ui';
import type { CourseWithStats } from '@/types/course';
import type { Role } from '@/types/next-auth';

const { mockPush, mockDeleteCourse, mockUpdateCourse } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockDeleteCourse: vi.fn(),
  mockUpdateCourse: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src?: string }) => (
    <img alt={alt} src={typeof src === 'string' ? src : undefined} />
  ),
}));
vi.mock('@/app/actions/course', () => ({
  deleteCourse: mockDeleteCourse,
  updateCourse: mockUpdateCourse,
}));
vi.mock('@/app/actions/course-ai-v4.6', () => ({ checkCourseGenerationJobV46: vi.fn() }));
vi.mock('@/components/dashboard/billing/BillingGateModal', () => ({
  default: () => <div data-testid="billing-gate" />,
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
import { buildPaginationRange } from './CoursesTableFooter';

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
  it('shows both tabs with badge-count accessible names and filters rows by the active tab', async () => {
    const user = userEvent.setup();
    const courses = [
      makeCourse({ id: 'v1', title: 'Video Course', type: 'video' }),
      makeCourse({ id: 's1', title: 'Reading Course One', type: 'text' }),
      makeCourse({ id: 's2', title: 'Reading Course Two', type: 'text' }),
    ];

    render(<CoursesListClient courses={courses} hasBilling viewerRole="owner" />);

    // The tab label and its Badge count are separate nodes, so the accessible
    // name is "Video 1" / "Reading Course 2" — NOT the old "Video (1)" format.
    expect(screen.getByRole('tab', { name: 'Video 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reading Course 2' })).toBeInTheDocument();

    // Opens on the tab that actually has courses when only one type is populated... here
    // both exist, so it defaults to Video per the "prefer Video" rule.
    expect(screen.getByText('Video Course')).toBeInTheDocument();
    expect(screen.queryByText('Reading Course One')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Reading Course 2' }));

    expect(screen.queryByText('Video Course')).not.toBeInTheDocument();
    expect(screen.getByText('Reading Course One')).toBeInTheDocument();
    expect(screen.getByText('Reading Course Two')).toBeInTheDocument();
  });

  it('opens on the Reading Course tab when the org has only reading courses', () => {
    render(
      <CoursesListClient
        courses={[makeCourse({ id: 'r1', title: 'Reading Only', type: 'text' })]}
        hasBilling
        viewerRole="owner"
      />,
    );

    // The persisted DB discriminant for reading courses is still 'text'.
    expect(screen.getByText('Reading Only')).toBeInTheDocument();
  });
});

describe('CoursesListClient — per-tab columns', () => {
  it('Video tab shows Course Name | Assigned Staff | Description | Action, with no Type/Role columns', () => {
    render(
      <CoursesListClient courses={[makeCourse({ type: 'video' })]} hasBilling viewerRole="owner" />,
    );

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Course Name', 'Assigned Staff', 'Description', 'Action']);
  });

  it('Reading tab shows Course Name | Assigned Staff | Date Created | Action, with no Type/Role columns', () => {
    render(
      <CoursesListClient
        courses={[makeCourse({ id: 'r1', title: 'Reading Course A', type: 'text' })]}
        hasBilling
        viewerRole="owner"
      />,
    );

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Course Name', 'Assigned Staff', 'Date Created', 'Action']);
  });
});

describe('CoursesListClient — per-tab illustrated empty state', () => {
  it('shows the empty panel when the active tab has zero courses and search is blank, while the tabs, counts, and search stay visible', () => {
    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);

    // Both tabs are empty, so the "prefer Video" default lands here first.
    expect(screen.getByText('No video courses yet.')).toBeInTheDocument();

    // Regression guard: the old empty-state hid the whole widget (tabs +
    // search included). The redesign keeps them rendered above the panel.
    expect(screen.getByRole('tab', { name: 'Video 0' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reading Course 0' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search courses')).toBeInTheDocument();

    // The table and its footer are replaced entirely, not just the rows.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument();
  });

  it('shows the Reading-tab empty panel with its own copy when switching to an empty Reading Course tab', async () => {
    const user = userEvent.setup();
    render(
      <CoursesListClient
        courses={[makeCourse({ id: 'v1', title: 'Only Video', type: 'video' })]}
        hasBilling
        viewerRole="owner"
      />,
    );

    // Defaults to Video (it has the one course); switch to the empty Reading tab.
    await user.click(screen.getByRole('tab', { name: 'Reading Course 0' }));

    expect(screen.getByText('No reading courses yet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reading Course 0' })).toBeInTheDocument();
  });

  it('a search that matches nothing renders the in-table "No courses found." row, not the illustrated panel', async () => {
    const user = userEvent.setup();
    render(
      <CoursesListClient courses={[makeCourse({ type: 'video' })]} hasBilling viewerRole="owner" />,
    );

    await user.type(screen.getByLabelText('Search courses'), 'zzz-no-match');

    // Table chrome (including headers) stays; only the body row changes.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('No courses found.')).toBeInTheDocument();
    expect(screen.queryByText('No video courses yet.')).not.toBeInTheDocument();

    const cell = screen.getByText('No courses found.').closest('td');
    expect(cell).toHaveAttribute('colspan', '4');
  });

  it('switching tabs resets pagination back to page 1', async () => {
    const user = userEvent.setup();
    const videoCourses = Array.from({ length: 15 }, (_, i) =>
      makeCourse({ id: `v${i + 1}`, title: `Video Course ${i + 1}`, type: 'video' }),
    );
    const readingCourses = [makeCourse({ id: 'r1', title: 'Reading Only Course', type: 'text' })];

    render(
      <CoursesListClient
        courses={[...videoCourses, ...readingCourses]}
        hasBilling
        viewerRole="owner"
      />,
    );

    // Defaults to Video (15 entries, 2 pages @ 10/page). Move to page 2.
    expect(screen.getByText('Video Course 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Video Course 11')).toBeInTheDocument();
    expect(screen.queryByText('Video Course 1')).not.toBeInTheDocument();

    // Switch away and back — the tab switch must reset currentPage to 1.
    await user.click(screen.getByRole('tab', { name: 'Reading Course 1' }));
    expect(screen.getByText('Reading Only Course')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Video 15' }));
    expect(screen.getByText('Video Course 1')).toBeInTheDocument();
    expect(screen.queryByText('Video Course 11')).not.toBeInTheDocument();
  });

  it('the empty-state secondary CTA flips the active tab', async () => {
    const user = userEvent.setup();
    render(
      <CoursesListClient
        courses={[makeCourse({ id: 'r1', title: 'Reading Only Course', type: 'text' })]}
        hasBilling
        viewerRole="owner"
      />,
    );

    // Defaults to Reading (only populated tab); manually visit the empty Video tab.
    await user.click(screen.getByRole('tab', { name: 'Video 0' }));
    expect(screen.getByText('No video courses yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View reading courses' }));

    expect(screen.getByText('Reading Only Course')).toBeInTheDocument();
    expect(screen.queryByText('No video courses yet.')).not.toBeInTheDocument();
  });

  it('primary "Create your first course" CTA is hidden without course.create, while the tab-switch CTA still shows', () => {
    render(<CoursesListClient courses={[]} hasBilling viewerRole="hr" />);

    expect(
      screen.queryByRole('button', { name: 'Create your first course' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View reading courses' })).toBeInTheDocument();
  });

  it('primary "Create your first course" CTA renders for a role with course.create', () => {
    render(<CoursesListClient courses={[]} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('button', { name: 'Create your first course' })).toBeInTheDocument();
  });
});

describe('CoursesListClient — row action gating per role', () => {
  const course = makeCourse();

  function actionsForRow() {
    const row = screen.getByText('Infection Control').closest('tr')!;
    return within(row).getByTestId('row-actions');
  }

  it('owner sees every action: Assign, View Source Document, Rename, Delete', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('supervisor (everything except billing) sees every action, exactly like owner', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="supervisor" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('finance (no course/document/assignment grants) sees no row actions', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="finance" />);

    const row = screen.getByText('Infection Control').closest('tr')!;
    expect(within(row).queryByTestId('row-actions')).not.toBeInTheDocument();
  });

  it('hr sees Assign and View Source Document, but no Rename/Delete (no course write grants)', () => {
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="hr" />);

    const actions = actionsForRow();
    expect(within(actions).getByRole('button', { name: 'Assign to staff' })).toBeInTheDocument();
    expect(
      within(actions).getByRole('button', { name: 'View Source Document' }),
    ).toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('never shows "View Source Document" for a course with no source-document lineage, even for a fully-permitted role', () => {
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

describe('CoursesListClient — header create affordance gated on course.create', () => {
  it('shows the Create Course button for owner', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('button', { name: /Create Course/i })).toBeInTheDocument();
  });

  it('hides the Create Course button for hr (no course.create)', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="hr" />);

    expect(screen.queryByRole('button', { name: /Create Course/i })).not.toBeInTheDocument();
  });
});

// The Video tab lists only already-offered courses, so this link is the sole
// remaining route into the adoptable global catalog.
describe('CoursesListClient — prebuilt catalog link', () => {
  const catalogLink = /Browse course catalog/i;

  it('navigates an owner to the prebuilt catalog from the Video tab', async () => {
    const user = userEvent.setup();
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="owner" />);

    await user.click(screen.getByRole('button', { name: catalogLink }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/courses/prebuilt');
  });

  it('hides the link for hr (no course.create)', () => {
    render(<CoursesListClient courses={[makeCourse()]} hasBilling viewerRole="hr" />);

    expect(screen.queryByRole('button', { name: catalogLink })).not.toBeInTheDocument();
  });

  it('is scoped to the Video tab and disappears on Reading Course', async () => {
    const user = userEvent.setup();
    const courses = [
      makeCourse({ id: 'v1', type: 'video' }),
      makeCourse({ id: 't1', type: 'text' }),
    ];
    render(<CoursesListClient courses={courses} hasBilling viewerRole="owner" />);

    expect(screen.getByRole('button', { name: catalogLink })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Reading Course 1' }));

    expect(screen.queryByRole('button', { name: catalogLink })).not.toBeInTheDocument();
  });

  it('opens the billing gate instead of navigating when the org has no active plan', async () => {
    const user = userEvent.setup();
    render(<CoursesListClient courses={[makeCourse()]} hasBilling={false} viewerRole="owner" />);

    await user.click(screen.getByRole('button', { name: catalogLink }));

    expect(screen.getByTestId('billing-gate')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('CoursesListClient — video-tab thumbnail rendering', () => {
  it('renders no <img> for a posterless video course (the square icon fallback would be cropped)', () => {
    const course = makeCourse({ type: 'video', thumbnail: null, title: 'No Poster Video' });
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    expect(screen.queryByAltText('No Poster Video')).not.toBeInTheDocument();
    expect(screen.getByText('No Poster Video')).toBeInTheDocument();
  });

  it('renders the thumbnail <img> for a video course with a poster', () => {
    const course = makeCourse({
      type: 'video',
      thumbnail: 'https://example.com/poster.jpg',
      title: 'Posted Video',
    });
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    expect(screen.getByAltText('Posted Video')).toHaveAttribute(
      'src',
      'https://example.com/poster.jpg',
    );
  });

  it('reading tab always renders the icon tile, falling back to the default icon without a thumbnail', () => {
    const course = makeCourse({
      id: 'r1',
      type: 'text',
      thumbnail: null,
      title: 'Reading No Poster',
    });
    render(<CoursesListClient courses={[course]} hasBilling viewerRole="owner" />);

    expect(screen.getByAltText('Reading No Poster')).toHaveAttribute(
      'src',
      '/images/icon-course-blue.svg',
    );
  });
});

describe('buildPaginationRange', () => {
  it('returns every page when total is 7 or fewer', () => {
    expect(buildPaginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPaginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(buildPaginationRange(1, 0)).toEqual([]);
  });

  it('windows around the current page with a single trailing ellipsis near the start', () => {
    expect(buildPaginationRange(1, 10)).toEqual([1, 2, 'ellipsis', 10]);
  });

  it('windows with leading and trailing ellipses when the current page is in the middle', () => {
    expect(buildPaginationRange(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
  });

  it('windows with a single leading ellipsis near the end', () => {
    expect(buildPaginationRange(10, 10)).toEqual([1, 'ellipsis', 9, 10]);
  });
});
