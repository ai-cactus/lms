/**
 * The Courses tab owns the redesigned export entry points: every trigger must
 * open the date-range modal first (never start a job directly), start the right
 * scope, and stay blocked while another export is in flight. It also paginates
 * client-side, so the slice must follow the page and page-size controls.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAuditorCourses, mockUseExportJobs, mockStartExport } = vi.hoisted(() => ({
  mockGetAuditorCourses: vi.fn(),
  mockUseExportJobs: vi.fn(),
  mockStartExport: vi.fn(),
}));

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/app/actions/auditor', () => ({ getAuditorCourses: mockGetAuditorCourses }));
vi.mock('./ExportJobsProvider', () => ({ useExportJobs: mockUseExportJobs }));
vi.mock('./AuditExportRangeModal', () => ({
  default: ({
    open,
    onGenerate,
  }: {
    open: boolean;
    onGenerate: (range: { from?: string; to?: string }) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Select date range">
        <button type="button" onClick={() => onGenerate({ from: '2026-01-01' })}>
          Generate Report
        </button>
      </div>
    ) : null,
}));

import AuditorCoursesTab from './AuditorCoursesTab';

function makeCourses(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `course-${i + 1}`,
    title: `Course ${i + 1}`,
    thumbnail: null,
    assignedStaff: 8,
    completionRate: 95,
    assignedDate: new Date('2026-01-15T14:20:00Z'),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuditorCourses.mockResolvedValue(makeCourses(12));
  mockUseExportJobs.mockReturnValue({
    jobs: [],
    activeJob: null,
    completedJob: null,
    startExport: mockStartExport,
    downloadJob: vi.fn(),
  });
});

describe('AuditorCoursesTab — export flow', () => {
  it('opens the date-range modal instead of starting an export directly', async () => {
    const user = userEvent.setup();
    render(<AuditorCoursesTab totalCourses={48} />);
    await screen.findByText('Course 1');

    await user.click(screen.getByRole('button', { name: /export all/i }));

    expect(screen.getByRole('dialog', { name: /select date range/i })).toBeInTheDocument();
    expect(mockStartExport).not.toHaveBeenCalled();
  });

  it('starts an all-courses export counted by the org-wide course total', async () => {
    const user = userEvent.setup();
    render(<AuditorCoursesTab totalCourses={48} />);
    await screen.findByText('Course 1');

    await user.click(screen.getByRole('button', { name: /export all/i }));
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'all-courses',
      scopeId: undefined,
      label: 'All courses report',
      entity: 'course',
      count: 48,
      from: '2026-01-01',
    });
  });

  it('starts a single-course export scoped to the clicked row', async () => {
    const user = userEvent.setup();
    render(<AuditorCoursesTab totalCourses={48} />);
    await screen.findByText('Course 1');

    const row = screen.getByText('Course 2').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'course',
      scopeId: 'course-2',
      label: 'Course: Course 2',
      entity: 'course',
      count: 1,
      from: '2026-01-01',
    });
  });

  it('blocks every export trigger while another export is in flight', async () => {
    mockUseExportJobs.mockReturnValue({
      jobs: [],
      activeJob: { id: 'job-1', label: 'All courses report', scope: 'all-courses' },
      completedJob: null,
      startExport: mockStartExport,
      downloadJob: vi.fn(),
    });
    render(<AuditorCoursesTab totalCourses={48} />);
    await screen.findByText('Course 1');

    expect(screen.getByRole('button', { name: /export all/i })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Export' })[0]).toBeDisabled();
  });
});

describe('AuditorCoursesTab — pagination', () => {
  it('shows only the first page of rows', async () => {
    render(<AuditorCoursesTab totalCourses={12} />);
    await screen.findByText('Course 1');

    expect(screen.getByText('Course 10')).toBeInTheDocument();
    expect(screen.queryByText('Course 11')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 10 of 12 entries')).toBeInTheDocument();
  });

  it('reveals the remaining rows on the next page', async () => {
    const user = userEvent.setup();
    render(<AuditorCoursesTab totalCourses={12} />);
    await screen.findByText('Course 1');

    await user.click(screen.getByRole('button', { name: /next page/i }));

    expect(screen.getByText('Course 11')).toBeInTheDocument();
    expect(screen.queryByText('Course 1')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 11 to 12 of 12 entries')).toBeInTheDocument();
  });

  it('renders the design empty state when the org has no courses', async () => {
    mockGetAuditorCourses.mockResolvedValue([]);
    render(<AuditorCoursesTab totalCourses={0} />);

    expect(await screen.findByText('No course yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Courses will appear here once staff finish assigned courses.'),
    ).toBeInTheDocument();
  });
});
