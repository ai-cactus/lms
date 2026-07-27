/**
 * Unit tests for the admin-dashboard Status Tracker overview widget.
 *
 * StatusTrackerOverview is purely presentational (no data fetching) but owns
 * real logic worth guarding directly:
 *   - top-5 slicing of the (already server-sorted) rows array
 *   - the "All caught up" empty state vs. the table branch
 *   - the "N at risk" pill count and the overdue/due-soon status badges
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusTrackerOverview from './StatusTrackerOverview';
import type { StatusTrackerRowView } from './StatusTrackerTableClient';

function makeRow(overrides: Partial<StatusTrackerRowView> = {}): StatusTrackerRowView {
  return {
    enrollmentId: 'e1',
    userId: 'u1',
    workerName: 'Worker One',
    workerEmail: 'worker.one@test.com',
    courseId: 'c1',
    courseTitle: 'HIPAA Basics',
    dueAt: '2024-06-01T00:00:00.000Z',
    daysOverdue: 3,
    daysUntilDue: null,
    ...overrides,
  };
}

describe('StatusTrackerOverview', () => {
  it('renders the "All caught up" empty state when there are no rows', () => {
    render(<StatusTrackerOverview rows={[]} />);

    expect(screen.getByText('All caught up — no overdue training')).toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view all/i })).not.toBeInTheDocument();
  });

  it('renders the "View all" link to the full status-tracker page when rows exist', () => {
    render(<StatusTrackerOverview rows={[makeRow()]} />);

    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/dashboard/status-tracker',
    );
  });

  it('renders only the top 5 rows even when more are supplied, but counts all in the pill', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeRow({ enrollmentId: `e${i}`, workerName: `Worker ${i}`, daysOverdue: 8 - i }),
    );

    render(<StatusTrackerOverview rows={rows} />);

    const table = screen.getByRole('table');
    const dataRows = within(table).getAllByRole('row').slice(1); // drop header row
    expect(dataRows).toHaveLength(5);
    // The first 5 (most-overdue, already sorted by the caller) are the ones
    // shown. Names appear twice per row (visible cell + the View link's
    // sr-only suffix), so assert on presence/absence rather than uniqueness.
    expect(within(table).getAllByText('Worker 0').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Worker 4').length).toBeGreaterThan(0);
    expect(within(table).queryAllByText('Worker 5')).toHaveLength(0);
    expect(screen.getByText('8 at risk')).toBeInTheDocument();
  });

  it('shows an overdue badge for overdue rows and a due-soon badge for near-deadline rows', () => {
    render(
      <StatusTrackerOverview
        rows={[
          makeRow({ enrollmentId: 'o', workerName: 'Olivia Overdue', daysOverdue: 3 }),
          makeRow({
            enrollmentId: 'n',
            workerName: 'Nadia Nearing',
            daysOverdue: null,
            daysUntilDue: 2,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('Overdue by 3 days').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Due in 2 days').length).toBeGreaterThan(0);
  });

  it("links each row's View action to the staff profile", () => {
    render(<StatusTrackerOverview rows={[makeRow({ userId: 'u42' })]} />);

    const staffLink = screen
      .getAllByRole('link')
      .find((link) => link.getAttribute('href') === '/dashboard/staff/u42');
    expect(staffLink).toBeDefined();
    expect(staffLink).toHaveTextContent(/view/i);
  });

  it('singularizes "day" for a row that is exactly 1 day overdue', () => {
    render(<StatusTrackerOverview rows={[makeRow({ daysOverdue: 1 })]} />);

    expect(screen.getAllByText('Overdue by 1 day').length).toBeGreaterThan(0);
  });
});
