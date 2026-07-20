/**
 * Regression test: "Bulk Organization export ignores date range" — the
 * Export tab's "Export PDF" button called `startExport({ scope: 'org', ... })`
 * with no date bounds even when the shared Audit Reports date-range filter
 * (`AuditFilterProvider`) had an active range selected. It now spreads
 * `toRangeInput(range)` into the call so the exported report respects the
 * same filter driving the on-screen tabs.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStartExport, mockUseExportJobs, mockUseAuditFilter } = vi.hoisted(() => ({
  mockStartExport: vi.fn(),
  mockUseExportJobs: vi.fn(),
  mockUseAuditFilter: vi.fn(),
}));

vi.mock('./ExportJobsProvider', () => ({ useExportJobs: mockUseExportJobs }));
vi.mock('./AuditFilterProvider', async () => {
  const actual =
    await vi.importActual<typeof import('./AuditFilterProvider')>('./AuditFilterProvider');
  return { ...actual, useAuditFilter: mockUseAuditFilter };
});

import AuditorExportTab from './AuditorExportTab';

beforeEach(() => {
  vi.clearAllMocks();
  mockUseExportJobs.mockReturnValue({
    jobs: [],
    startExport: mockStartExport,
    downloadJob: vi.fn(),
  });
  mockUseAuditFilter.mockReturnValue({ range: { from: '', to: '' }, setRange: vi.fn() });
});

describe('AuditorExportTab — date-range threading', () => {
  it('calls startExport with no from/to when the filter is unset ("all time")', async () => {
    const user = userEvent.setup();
    render(<AuditorExportTab />);

    await user.click(screen.getByRole('button', { name: /export pdf/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'org',
      label: 'Organization report',
    });
  });

  it('threads the active from/to range into startExport', async () => {
    mockUseAuditFilter.mockReturnValue({
      range: { from: '2026-01-01', to: '2026-03-31' },
      setRange: vi.fn(),
    });
    const user = userEvent.setup();
    render(<AuditorExportTab />);

    await user.click(screen.getByRole('button', { name: /export pdf/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'org',
      label: 'Organization report',
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('threads a one-sided (from-only) range', async () => {
    mockUseAuditFilter.mockReturnValue({
      range: { from: '2026-01-01', to: '' },
      setRange: vi.fn(),
    });
    const user = userEvent.setup();
    render(<AuditorExportTab />);

    await user.click(screen.getByRole('button', { name: /export pdf/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'org',
      label: 'Organization report',
      from: '2026-01-01',
    });
  });

  it('disables the export button while an org export is already processing', () => {
    mockUseExportJobs.mockReturnValue({
      jobs: [
        {
          id: 'job-1',
          label: 'Organization report',
          scope: 'org',
          status: 'processing',
          progress: 40,
          downloaded: false,
        },
      ],
      startExport: mockStartExport,
      downloadJob: vi.fn(),
    });

    render(<AuditorExportTab />);

    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
  });
});
