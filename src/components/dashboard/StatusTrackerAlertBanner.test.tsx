/**
 * The two site-wide dashboard banners can appear at the same time (a paused
 * subscription AND overdue training), stacked by
 * `src/app/dashboard/(main)/layout.tsx`. They must not butt against each other,
 * which they did while only this one carried a bottom margin.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import StatusTrackerAlertBanner from './StatusTrackerAlertBanner';
import { DASHBOARD_BANNER_SHELL } from './banner-shell';

describe('StatusTrackerAlertBanner', () => {
  it('renders nothing when no enrollment has hard-escalated', () => {
    const { container } = render(<StatusTrackerAlertBanner hardEscalationCount={0} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('uses the shared banner shell, so a stack of banners is evenly spaced', () => {
    render(<StatusTrackerAlertBanner hardEscalationCount={3} />);

    expect(screen.getByRole('alert')).toHaveClass(...DASHBOARD_BANNER_SHELL.split(' '));
  });

  // BUG-42: the count is of ASSIGNMENTS and the threshold is per assignment.
  it('counts overdue assignments past their escalation point, singular and plural', () => {
    const { rerender } = render(<StatusTrackerAlertBanner hardEscalationCount={1} />);
    expect(
      screen.getByText(
        '1 overdue assignment has passed its escalation point (7+ days by default) and needs attention.',
      ),
    ).toBeInTheDocument();

    rerender(<StatusTrackerAlertBanner hardEscalationCount={4} />);
    expect(
      screen.getByText(
        '4 overdue assignments have passed their escalation point (7+ days by default) and need attention.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/worker/)).not.toBeInTheDocument();
  });
});
