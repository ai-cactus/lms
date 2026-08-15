/**
 * The export banners replaced the old Export tab, so they are the only place the
 * user sees an export's progress and the only route to the finished CSV.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUseExportJobs, mockDownloadJob } = vi.hoisted(() => ({
  mockUseExportJobs: vi.fn(),
  mockDownloadJob: vi.fn(),
}));

vi.mock('./ExportJobsProvider', () => ({ useExportJobs: mockUseExportJobs }));

import AuditExportBanner from './AuditExportBanner';
import type { ExportJob } from './ExportJobsProvider';

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: 'job-1',
    label: 'All courses report',
    scope: 'all-courses',
    entity: 'course',
    count: 48,
    status: 'processing',
    progress: 40,
    ...overrides,
  };
}

function mockJobs(activeJob: ExportJob | null, completedJob: ExportJob | null) {
  mockUseExportJobs.mockReturnValue({
    jobs: [activeJob, completedJob].filter(Boolean),
    activeJob,
    completedJob,
    startExport: vi.fn(),
    downloadJob: mockDownloadJob,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditExportBanner', () => {
  it('renders nothing when no export is running or finished', () => {
    mockJobs(null, null);
    const { container } = render(<AuditExportBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts the scope and disables the action while an export is in flight', () => {
    mockJobs(job(), null);
    render(<AuditExportBanner />);

    expect(screen.getByText('Exporting 48 Courses...')).toBeInTheDocument();
    expect(
      screen.getByText('Your CSV will be ready shortly. Please do not close this tab.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled();
  });

  it('pluralizes the staff scope using the design wording', () => {
    mockJobs(job({ entity: 'staff', scope: 'all-staff', count: 30 }), null);
    render(<AuditExportBanner />);

    expect(screen.getByText('Exporting 30 Staffs...')).toBeInTheDocument();
  });

  it('uses the singular form for a single-row export', () => {
    mockJobs(job({ scope: 'course', count: 1 }), null);
    render(<AuditExportBanner />);

    expect(screen.getByText('Exporting 1 Course...')).toBeInTheDocument();
  });

  it('offers the finished report for download once the export completes', async () => {
    const user = userEvent.setup();
    mockJobs(null, job({ status: 'completed', progress: 100 }));
    render(<AuditExportBanner />);

    expect(screen.getByText('Exported 48 Course Reports')).toBeInTheDocument();
    expect(screen.getByText('Your audit report is ready.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view report/i }));
    expect(mockDownloadJob).toHaveBeenCalledExactlyOnceWith('job-1');
  });

  it('keeps showing the in-flight export when a previous one has finished', () => {
    mockJobs(job({ id: 'job-2' }), job({ id: 'job-1', status: 'completed' }));
    render(<AuditExportBanner />);

    expect(screen.getByText('Exporting 48 Courses...')).toBeInTheDocument();
    expect(screen.queryByText(/exported 48 course reports/i)).not.toBeInTheDocument();
  });
});
