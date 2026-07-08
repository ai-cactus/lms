/**
 * Unit tests for the admin-dashboard Status Tracker overview widget.
 *
 * StatusTrackerOverview is purely presentational (no data fetching) but owns
 * two pieces of real logic worth guarding directly:
 *   - top-5 slicing of the (already server-sorted) rows array
 *   - the "All caught up" empty state vs. the summary+table branch
 *   - the hard-escalation color threshold (>= hardThresholdDays)
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusTrackerOverview, { type StatusTrackerOverviewRow } from './StatusTrackerOverview';

function makeRow(overrides: Partial<StatusTrackerOverviewRow> = {}): StatusTrackerOverviewRow {
  return {
    enrollmentId: 'e1',
    workerName: 'Worker One',
    courseTitle: 'HIPAA Basics',
    dueAt: '2024-06-01T00:00:00.000Z',
    daysOverdue: 3,
    ...overrides,
  };
}

describe('StatusTrackerOverview', () => {
  it('renders the "All caught up" empty state when there are no rows', () => {
    render(
      <StatusTrackerOverview
        overdueCount={0}
        hardEscalationCount={0}
        hardThresholdDays={7}
        rows={[]}
      />,
    );

    expect(screen.getByText('All caught up — no overdue training')).toBeInTheDocument();
    // The summary chips and table are not rendered in the empty state.
    expect(screen.queryByText('Overdue training')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('always renders the "View all" link to the full status-tracker page', () => {
    render(
      <StatusTrackerOverview
        overdueCount={0}
        hardEscalationCount={0}
        hardThresholdDays={7}
        rows={[]}
      />,
    );

    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/dashboard/status-tracker',
    );
  });

  it('renders only the top 5 rows even when more are supplied', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeRow({ enrollmentId: `e${i}`, workerName: `Worker ${i}`, daysOverdue: 8 - i }),
    );

    render(
      <StatusTrackerOverview
        overdueCount={8}
        hardEscalationCount={2}
        hardThresholdDays={7}
        rows={rows}
      />,
    );

    const table = screen.getByRole('table');
    const dataRows = within(table).getAllByRole('row').slice(1); // drop header row
    expect(dataRows).toHaveLength(5);
    // The first 5 (most-overdue, already sorted by the caller) are the ones shown.
    expect(within(table).getByText('Worker 0')).toBeInTheDocument();
    expect(within(table).getByText('Worker 4')).toBeInTheDocument();
    expect(within(table).queryByText('Worker 5')).not.toBeInTheDocument();
  });

  it('displays the overdue and hard-escalation summary counts', () => {
    render(
      <StatusTrackerOverview
        overdueCount={12}
        hardEscalationCount={4}
        hardThresholdDays={7}
        rows={[makeRow()]}
      />,
    );

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Hard escalations (7+ days)')).toBeInTheDocument();
  });

  it('applies the error color to the hard-escalation count only when > 0', () => {
    const { rerender } = render(
      <StatusTrackerOverview
        overdueCount={5}
        hardEscalationCount={0}
        hardThresholdDays={7}
        rows={[makeRow()]}
      />,
    );
    expect(screen.getByText('0')).not.toHaveClass('text-error');

    rerender(
      <StatusTrackerOverview
        overdueCount={5}
        hardEscalationCount={3}
        hardThresholdDays={7}
        rows={[makeRow()]}
      />,
    );
    expect(screen.getByText('3')).toHaveClass('text-error');
  });

  it('marks a row as a hard escalation once daysOverdue crosses the threshold (>=)', () => {
    render(
      <StatusTrackerOverview
        overdueCount={2}
        hardEscalationCount={1}
        hardThresholdDays={7}
        rows={[
          makeRow({ enrollmentId: 'hard', workerName: 'Hard Worker', daysOverdue: 7 }),
          makeRow({ enrollmentId: 'soft', workerName: 'Soft Worker', daysOverdue: 6 }),
        ]}
      />,
    );

    expect(screen.getByText('7 days')).toHaveClass('text-error');
    expect(screen.getByText('6 days')).not.toHaveClass('text-error');
  });

  it('singularizes "day" for a row that is exactly 1 day overdue', () => {
    render(
      <StatusTrackerOverview
        overdueCount={1}
        hardEscalationCount={0}
        hardThresholdDays={7}
        rows={[makeRow({ daysOverdue: 1 })]}
      />,
    );

    expect(screen.getByText('1 day')).toBeInTheDocument();
  });
});
