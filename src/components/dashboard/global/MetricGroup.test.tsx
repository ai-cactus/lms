/**
 * The trend chip compares with exactly {@link TREND_WINDOW_DAYS} days ago, and
 * must say so. A rise or fall is coloured by whether it is good news; no
 * movement is neither, so it carries no arrow and no colour (BUG-42).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Users } from 'lucide-react';
import MetricGroup, { type MetricCardData } from './MetricGroup';

function renderTrend(trendPercent: number | null, higherIsBetter = true) {
  const metric: MetricCardData = {
    label: 'Total Staff Count',
    value: '10',
    icon: Users,
    iconSurface: 'bg-primary',
    trendPercent,
    higherIsBetter,
  };
  const { container } = render(<MetricGroup title="Footprint" metrics={[metric]} />);
  const chip = screen.queryByText('vs 30 days ago')?.parentElement ?? null;
  return { container, chip };
}

describe('MetricGroup — trend chip', () => {
  it('renders no chip without a baseline', () => {
    const { chip } = renderTrend(null);
    expect(chip).toBeNull();
  });

  it.each([
    ['a favourable rise', 12, true, 'lucide-arrow-up', 'text-success'],
    ['an unfavourable rise', 12, false, 'lucide-arrow-up', 'text-error'],
    ['a favourable fall', -8, false, 'lucide-arrow-down', 'text-success'],
    ['an unfavourable fall', -8, true, 'lucide-arrow-down', 'text-error'],
  ])('shows %s with its arrow and tone', (_label, trend, higherIsBetter, arrow, tone) => {
    const { chip } = renderTrend(trend, higherIsBetter);

    expect(chip).not.toBeNull();
    expect(chip).toHaveClass(tone);
    expect(chip!.querySelector(`svg.${arrow}`)).not.toBeNull();
    expect(chip).toHaveTextContent(`${Math.abs(trend)}%`);
  });

  it('shows 0% with no arrow and a neutral tone', () => {
    const { chip } = renderTrend(0);

    expect(chip).toHaveTextContent('0%');
    expect(chip!.querySelector('svg')).toBeNull();
    expect(chip).toHaveClass('text-text-secondary');
    expect(chip).not.toHaveClass('text-success');
    expect(chip).not.toHaveClass('text-error');
  });
});
