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

  it('pluralises the worker count', () => {
    const { rerender } = render(<StatusTrackerAlertBanner hardEscalationCount={1} />);
    expect(screen.getByText(/1 worker has training overdue/)).toBeInTheDocument();

    rerender(<StatusTrackerAlertBanner hardEscalationCount={4} />);
    expect(screen.getByText(/4 workers have training overdue/)).toBeInTheDocument();
  });
});
