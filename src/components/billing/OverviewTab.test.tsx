/**
 * Unit tests for src/components/billing/OverviewTab.tsx
 *
 * Defect C — Overview stale after resume. `BillingPage` bumps a `refreshKey`
 * prop on any SubscriptionTab mutation (resume/reactivate/plan swap);
 * OverviewTab must include `refreshKey` in its fetch effect's dependency
 * array so a bump triggers a refetch without a manual page reload.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OverviewTab from './OverviewTab';

function overviewResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organization: { name: 'Acme Co', staffCount: '5' },
    subscription: null,
    activeStaffCount: 3,
    defaultPaymentMethod: null,
    recentInvoices: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => overviewResponse(),
  });
});

describe('OverviewTab — refetch on refreshKey bump (Defect C)', () => {
  it('fetches billing overview once on mount', async () => {
    render(<OverviewTab onChangeTab={vi.fn()} refreshKey={0} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith('/api/billing/overview');
  });

  it('refetches when refreshKey is bumped, without requiring a manual reload', async () => {
    const { rerender } = render(<OverviewTab onChangeTab={vi.fn()} refreshKey={0} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // Simulate BillingPage bumping overviewRefreshKey after a SubscriptionTab
    // mutation (e.g. resume).
    rerender(<OverviewTab onChangeTab={vi.fn()} refreshKey={1} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('does NOT refetch on a rerender that leaves refreshKey unchanged', async () => {
    const onChangeTab = vi.fn();
    const { rerender } = render(<OverviewTab onChangeTab={onChangeTab} refreshKey={2} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // A rerender with an unrelated prop change but the SAME refreshKey.
    rerender(<OverviewTab onChangeTab={vi.fn()} refreshKey={2} />);

    // Give any accidental extra effect run a chance to fire before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('renders the refetched (unpaused) subscription data after a refreshKey bump', async () => {
    const pausedFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () =>
        overviewResponse({
          subscription: {
            plan: 'professional',
            billingCycle: 'yearly',
            status: 'active',
            currentPeriodEnd: '2026-12-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            // No pauseEndsAt — keeps the pause state 'paused' (not 'expired')
            // regardless of the real system clock when this test runs.
            pausedAt: '2026-01-01T00:00:00.000Z',
            pauseEndsAt: null,
            discountPromoCode: null,
            discountCouponName: null,
            discountPercentOff: null,
            discountAmountOff: null,
            discountCurrency: null,
            discountDuration: null,
            discountEndsAt: null,
          },
        }),
    });
    global.fetch = pausedFetch;

    const { rerender } = render(<OverviewTab onChangeTab={vi.fn()} refreshKey={0} />);
    await screen.findByText('Your subscription is paused');

    // After resume, the SAME endpoint now reports an unpaused subscription.
    pausedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        overviewResponse({
          subscription: {
            plan: 'professional',
            billingCycle: 'yearly',
            status: 'active',
            currentPeriodEnd: '2026-12-01T00:00:00.000Z',
            cancelAtPeriodEnd: false,
            pausedAt: null,
            pauseEndsAt: null,
            discountPromoCode: null,
            discountCouponName: null,
            discountPercentOff: null,
            discountAmountOff: null,
            discountCurrency: null,
            discountDuration: null,
            discountEndsAt: null,
          },
        }),
    });

    rerender(<OverviewTab onChangeTab={vi.fn()} refreshKey={1} />);

    await waitFor(() =>
      expect(screen.queryByText('Your subscription is paused')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Next invoice on Dec 1, 2026')).toBeInTheDocument();
  });
});
