/**
 * The Staffs tab renders two columns whose headers promise more than the data
 * model has ("Department/Role", "Last Completion"), so these tests pin what is
 * actually shown: the server-composed role label, and a real completion
 * timestamp with an em dash when nothing has completed.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAuditorStaff, mockUseExportJobs, mockStartExport } = vi.hoisted(() => ({
  mockGetAuditorStaff: vi.fn(),
  mockUseExportJobs: vi.fn(),
  mockStartExport: vi.fn(),
}));

vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/app/actions/auditor', () => ({ getAuditorStaff: mockGetAuditorStaff }));
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
        <button type="button" onClick={() => onGenerate({})}>
          Generate Report
        </button>
      </div>
    ) : null,
}));

import AuditorStaffTab from './AuditorStaffTab';

const STAFF = [
  {
    id: 'ou-1',
    name: 'Alex Rivera',
    email: 'alex@acme.com',
    roleLabel: 'Compliance/ Nurse',
    coursesAssigned: 12,
    coursesCompleted: 12,
    lastCompletion: new Date('2026-01-15T14:20:00Z'),
  },
  {
    id: 'ou-2',
    name: 'Sarah Chen',
    email: 'sarah@acme.com',
    roleLabel: 'Therapist / Clinician',
    coursesAssigned: 3,
    coursesCompleted: 0,
    lastCompletion: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuditorStaff.mockResolvedValue(STAFF);
  mockUseExportJobs.mockReturnValue({
    jobs: [],
    activeJob: null,
    completedJob: null,
    startExport: mockStartExport,
    downloadJob: vi.fn(),
  });
});

describe('AuditorStaffTab — columns', () => {
  it('uses the design headers and card title', async () => {
    render(<AuditorStaffTab totalStaff={30} />);
    await screen.findByText('Alex Rivera');

    expect(screen.getByRole('heading', { name: 'All Staffs' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Department/Role' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last Completion' })).toBeInTheDocument();
  });

  it('renders the server-composed role label verbatim', async () => {
    render(<AuditorStaffTab totalStaff={30} />);
    await screen.findByText('Alex Rivera');

    expect(screen.getByText('Compliance/ Nurse')).toBeInTheDocument();
    expect(screen.getByText('Therapist / Clinician')).toBeInTheDocument();
  });

  it('shows an em dash rather than inventing a date when nothing has completed', async () => {
    render(<AuditorStaffTab totalStaff={30} />);
    await screen.findByText('Sarah Chen');

    const row = screen.getByText('Sarah Chen').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
  });
});

describe('AuditorStaffTab — export flow', () => {
  it('starts an all-staff export counted by the org-wide staff total', async () => {
    const user = userEvent.setup();
    render(<AuditorStaffTab totalStaff={30} />);
    await screen.findByText('Alex Rivera');

    await user.click(screen.getByRole('button', { name: /export all/i }));
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'all-staff',
      scopeId: undefined,
      label: 'All staff report',
      entity: 'staff',
      count: 30,
    });
  });

  it('starts a single-staff export scoped to the membership id', async () => {
    const user = userEvent.setup();
    render(<AuditorStaffTab totalStaff={30} />);
    await screen.findByText('Alex Rivera');

    const row = screen.getByText('Alex Rivera').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: /generate report/i }));

    expect(mockStartExport).toHaveBeenCalledExactlyOnceWith({
      scope: 'staff',
      scopeId: 'ou-1',
      label: 'Staff: Alex Rivera',
      entity: 'staff',
      count: 1,
    });
  });
});
