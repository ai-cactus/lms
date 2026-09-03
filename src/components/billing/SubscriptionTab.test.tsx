/**
 * Unit tests for src/components/billing/SubscriptionTab.tsx
 *
 * Defect A — plan-switch confirmation + cycle-default fix:
 *   - Billing-cycle toggle seeding: when `currentPlan` is set, the cycle
 *     toggle is seeded from the `billingCycle` prop (via the local
 *     `isBillingCycle` type guard); an invalid/missing cycle, or no
 *     `currentPlan` at all (new subscriber), falls back to 'yearly'.
 *   - When `hasLiveSubscription` is false (no live subscription — a brand
 *     new subscriber), clicking "Subscribe" calls checkout immediately with
 *     no confirmation dialog (regression guard against over-applying the
 *     dialog).
 *
 * Phase 4 / Issue 3 — plan-change classification + async preview:
 *   - When `hasLiveSubscription` is true, clicking "Subscribe" on a
 *     non-current plan first POSTs to `preview-plan-change` (no checkout
 *     call yet), then opens a "Confirm your plan change" dialog whose copy
 *     and confirm-button label branch on the returned `classification`
 *     (`scheduled` / `immediate_prorate` / `no_op`). Cancel closes the
 *     dialog and fires no checkout call; Confirm calls checkout with the
 *     previewed plan/cycle.
 *
 * Stripe-as-source-of-truth plan prices — graceful degradation:
 *   - A `planPrices` entry missing for a plan/cycle renders "Price
 *     unavailable" (never `$NaN`/blank) and leaves Subscribe enabled.
 *   - A full `planPrices` entry renders the derived `$X/mo` and a "save X%"
 *     clause only when the cycle is genuinely cheaper than monthly.
 *
 * `isBillingCycle` is a local, non-exported helper inside this client
 * component — it is exercised here indirectly through the rendered cycle
 * toggle rather than imported directly.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlanPriceMap, StripePriceInfo } from '@/lib/billing-prices';

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import SubscriptionTab from './SubscriptionTab';

// ── Helpers ───────────────────────────────────────────────────────────────────

function priceInfo(overrides: Partial<StripePriceInfo> = {}): StripePriceInfo {
  return {
    unitAmountCents: 9900,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    effectiveMonthlyCents: 9900,
    ...overrides,
  };
}

/** planPrices with every plan/cycle absent — the "Stripe unavailable" state. */
function emptyPlanPrices(): PlanPriceMap {
  return { starter: {}, growth: {}, pro: {}, enterprise: {} };
}

/**
 * A fully-populated planPrices fixture. Starter: $99/mo, $82/mo quarterly
 * (~17% off), $74/mo yearly (25% off) — mirrors realistic Stripe-derived
 * numbers without being tied to any real test-mode price id.
 */
function fullPlanPrices(): PlanPriceMap {
  return {
    starter: {
      monthly: priceInfo({ unitAmountCents: 9900, effectiveMonthlyCents: 9900 }),
      quarterly: priceInfo({
        unitAmountCents: 24600,
        interval: 'month',
        intervalCount: 3,
        effectiveMonthlyCents: 8200,
      }),
      yearly: priceInfo({
        unitAmountCents: 89000,
        interval: 'year',
        intervalCount: 1,
        effectiveMonthlyCents: 7417,
      }),
    },
    growth: {
      monthly: priceInfo({ unitAmountCents: 14900, effectiveMonthlyCents: 14900 }),
      quarterly: priceInfo({
        unitAmountCents: 40200,
        interval: 'month',
        intervalCount: 3,
        effectiveMonthlyCents: 13400,
      }),
      yearly: priceInfo({
        unitAmountCents: 134000,
        interval: 'year',
        intervalCount: 1,
        effectiveMonthlyCents: 11167,
      }),
    },
    pro: {
      monthly: priceInfo({ unitAmountCents: 24900, effectiveMonthlyCents: 24900 }),
      quarterly: priceInfo({
        unitAmountCents: 68000,
        interval: 'month',
        intervalCount: 3,
        effectiveMonthlyCents: 22667,
      }),
      yearly: priceInfo({
        unitAmountCents: 224000,
        interval: 'year',
        intervalCount: 1,
        effectiveMonthlyCents: 18667,
      }),
    },
    enterprise: {},
  };
}

function renderTab(overrides: Partial<React.ComponentProps<typeof SubscriptionTab>> = {}) {
  const props = {
    orgStaffCount: 5,
    currentPlan: null as string | null,
    planPrices: emptyPlanPrices(),
    hasLiveSubscription: false,
    billingCycle: null as string | null,
    onChangeTab: vi.fn(),
    onMutated: vi.fn(),
    ...overrides,
  };
  return { ...render(<SubscriptionTab {...props} />), props };
}

/** The cycle-toggle button is "active" when it carries the selected styling. */
function isActiveCycleButton(name: RegExp): boolean {
  return screen.getByRole('button', { name }).className.includes('bg-background');
}

function subscribeButton(planKey: string): HTMLElement {
  const btn = document.getElementById(`plan-btn-${planKey}`);
  if (!btn) throw new Error(`plan-btn-${planKey} not found`);
  return btn;
}

function planCard(planKey: string): HTMLElement {
  const btn = subscribeButton(planKey);
  const card = btn.closest('div.relative');
  if (!card) throw new Error(`plan card for ${planKey} not found`);
  return card as HTMLElement;
}

/**
 * Routes `fetch` by endpoint so a single mock can serve both the
 * preview-plan-change call (fired on plan-card click, when
 * `hasLiveSubscription` is true) and the checkout/cancel-scheduled-change
 * calls fired afterward. Each response defaults to `{ ok: true, json: {} }`
 * unless overridden.
 */
function mockFetchRouter(responses: {
  preview?: unknown;
  previewOk?: boolean;
  checkout?: unknown;
  cancelScheduled?: unknown;
}): { fn: typeof fetch; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: unknown, opts?: RequestInit) => {
    const urlStr = String(url);
    const body = opts?.body ? JSON.parse(opts.body as string) : undefined;
    calls.push({ url: urlStr, body });
    if (urlStr.includes('preview-plan-change')) {
      return {
        ok: responses.previewOk ?? true,
        json: async () => responses.preview ?? {},
      };
    }
    if (urlStr.includes('cancel-scheduled-change')) {
      return { ok: true, json: async () => responses.cancelScheduled ?? { success: true } };
    }
    return { ok: true, json: async () => responses.checkout ?? {} };
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

// ── Billing-cycle seeding ────────────────────────────────────────────────────

describe('SubscriptionTab — billing-cycle seeding', () => {
  it('seeds the cycle toggle from the billingCycle prop when currentPlan is set', () => {
    renderTab({ currentPlan: 'growth', billingCycle: 'quarterly' });

    expect(isActiveCycleButton(/quarterly/i)).toBe(true);
    expect(isActiveCycleButton(/^yearly/i)).toBe(false);
  });

  it('defaults to yearly when currentPlan is set but billingCycle is an unrecognized value', () => {
    renderTab({ currentPlan: 'growth', billingCycle: 'weekly' });

    expect(isActiveCycleButton(/^yearly/i)).toBe(true);
  });

  it('defaults to yearly when currentPlan is set but billingCycle is null', () => {
    renderTab({ currentPlan: 'growth', billingCycle: null });

    expect(isActiveCycleButton(/^yearly/i)).toBe(true);
  });

  it('defaults to yearly for a brand-new subscriber (no currentPlan) even if billingCycle is set', () => {
    // billingCycle should never be populated without a currentPlan in practice,
    // but the guard is `currentPlan && isBillingCycle(billingCycle)` — confirm
    // the missing currentPlan alone forces the yearly default.
    renderTab({ currentPlan: null, billingCycle: 'monthly' });

    expect(isActiveCycleButton(/^yearly/i)).toBe(true);
    expect(isActiveCycleButton(/^monthly/i)).toBe(false);
  });
});

// ── Plan-switch confirmation (live subscription) ────────────────────────────

describe('SubscriptionTab — plan-switch confirmation dialog (hasLiveSubscription=true)', () => {
  it('previews BEFORE opening the dialog, and shows "scheduled" copy (no charge today) for a downgrade', async () => {
    const { fn, calls } = mockFetchRouter({
      preview: { classification: 'scheduled', effectiveAt: '2026-08-17T00:00:00.000Z' },
    });
    global.fetch = fn;

    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByText('Confirm your plan change')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/runs until August 17, 2026/i);
    expect(dialog).toHaveTextContent(/no charge today/i);
    expect(dialog).toHaveTextContent(/new Starter plan starts then/i);
    // The preview call happens BEFORE any checkout call.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('preview-plan-change');
    expect(calls[0]!.body).toEqual({ planKey: 'starter', billingCycle: 'yearly' });
    // Scheduled changes use "Schedule change" as the confirm label.
    expect(screen.getByRole('button', { name: 'Schedule change' })).toBeInTheDocument();
  });

  it('shows "immediate_prorate" copy with the server-previewed charge amount for an upgrade', async () => {
    const { fn } = mockFetchRouter({
      preview: { classification: 'immediate_prorate', amountDueCents: 5000, currency: 'usd' },
    });
    global.fetch = fn;

    renderTab({
      currentPlan: 'starter',
      hasLiveSubscription: true,
      billingCycle: 'monthly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('growth'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/charged the prorated difference/i);
    expect(dialog).toHaveTextContent('$50.00');
    expect(dialog).toHaveTextContent(/takes effect immediately/i);
    // Immediate charges keep the default "Confirm change" label (not "Schedule change").
    expect(screen.getByRole('button', { name: 'Confirm change' })).toBeInTheDocument();
  });

  it('omits the amount clause when the server preview has no amountDueCents/currency', async () => {
    const { fn } = mockFetchRouter({
      preview: { classification: 'immediate_prorate', amountDueCents: null, currency: null },
    });
    global.fetch = fn;

    renderTab({
      currentPlan: 'starter',
      hasLiveSubscription: true,
      billingCycle: 'monthly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('growth'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/charged the prorated difference now/i);
    expect(dialog).not.toHaveTextContent('$');
  });

  it('renders "no_op" copy defensively when the server preview reports no_op', async () => {
    const { fn } = mockFetchRouter({ preview: { classification: 'no_op' } });
    global.fetch = fn;

    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/you're already on the Starter plan/i);
  });

  it('Cancel closes the dialog after the preview, fires no checkout call, and leaves state unchanged', async () => {
    const { fn, calls } = mockFetchRouter({
      preview: { classification: 'scheduled', effectiveAt: '2026-08-17T00:00:00.000Z' },
    });
    global.fetch = fn;

    const { props } = renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toHaveLength(1); // preview only — no checkout call
    expect(props.onMutated).not.toHaveBeenCalled();
    expect(props.onChangeTab).not.toHaveBeenCalled();
  });

  it('Confirm calls the checkout endpoint with the previewed plan and cycle', async () => {
    const { fn, calls } = mockFetchRouter({
      preview: { classification: 'scheduled', effectiveAt: '2026-08-17T00:00:00.000Z' },
    });
    global.fetch = fn;

    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Schedule change' }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.url).toBe('/api/billing/subscription/checkout');
    expect(calls[1]!.body).toEqual({ planKey: 'starter', billingCycle: 'yearly' });
  });

  it('shows a "Loading..." state on the clicked plan card while the preview is in flight', async () => {
    let resolvePreview!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    global.fetch = vi.fn(
      () => new Promise((resolve) => (resolvePreview = resolve)),
    ) as unknown as typeof fetch;

    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));

    expect(subscribeButton('starter')).toHaveTextContent('Loading...');
    expect(subscribeButton('starter')).toBeDisabled();

    resolvePreview({ ok: true, json: async () => ({ classification: 'scheduled' }) });
    await screen.findByRole('dialog');
  });

  it('surfaces a preview error inline instead of opening the dialog', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: 'Your subscription is in an invalid state. Please contact support.',
      }),
    });

    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      billingCycle: 'yearly',
      planPrices: fullPlanPrices(),
    });

    await userEvent.click(subscribeButton('starter'));

    await screen.findByText(/invalid state/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ── New-subscriber regression guard (no live subscription) ─────────────────

describe('SubscriptionTab — new subscriber goes straight to checkout (hasLiveSubscription=false)', () => {
  it('calls checkout immediately with no confirmation dialog', async () => {
    renderTab({
      currentPlan: null,
      hasLiveSubscription: false,
      billingCycle: null,
    });

    await userEvent.click(subscribeButton('starter'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/billing/subscription/checkout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ planKey: 'starter', billingCycle: 'yearly' }),
      }),
    );
  });

  it('never renders the plan-change dialog even after checkout resolves', async () => {
    renderTab({ currentPlan: null, hasLiveSubscription: false });

    await userEvent.click(subscribeButton('growth'));

    // Let the resolved fetch promise flush before asserting the negative.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Confirm your plan change')).not.toBeInTheDocument();
  });
});

// ── Stripe-sourced plan prices — graceful degradation ───────────────────────

describe('SubscriptionTab — plan cards with missing/partial planPrices', () => {
  it('renders "Price unavailable" (not $NaN or blank) and keeps Subscribe enabled', () => {
    renderTab({ currentPlan: null, planPrices: emptyPlanPrices() });

    const starterCard = planCard('starter');
    expect(starterCard).toHaveTextContent('Price unavailable');
    expect(starterCard).not.toHaveTextContent('NaN');
    expect(starterCard.textContent).not.toMatch(/\$\d/);
    expect(subscribeButton('starter')).not.toBeDisabled();
    expect(subscribeButton('starter')).toHaveTextContent('Subscribe');
  });

  it('renders "Price unavailable" for a plan/cycle that is present for other cycles but not this one', () => {
    const partial = emptyPlanPrices();
    partial.starter.monthly = priceInfo({ effectiveMonthlyCents: 9900 });
    // Yearly (the default toggle state) is left absent.
    renderTab({ currentPlan: null, planPrices: partial });

    expect(planCard('starter')).toHaveTextContent('Price unavailable');
  });
});

describe('SubscriptionTab — plan cards with full planPrices', () => {
  it('renders the expected $X/mo for the selected cycle', () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices(), billingCycle: null });

    // Default cycle for a brand-new subscriber is 'yearly'.
    // Growth yearly: round(134000 / 12) = 11167 effectiveMonthlyCents -> round(11167/100) = $112.
    // Pro yearly: round(224000 / 12) = 18667 effectiveMonthlyCents -> round(18667/100) = $187.
    expect(planCard('starter')).toHaveTextContent('$74');
    expect(planCard('growth')).toHaveTextContent('$112');
    expect(planCard('pro')).toHaveTextContent('$187');
  });

  it('renders the pro card price from the Stripe-derived planPrices map for the monthly cycle', async () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    await userEvent.click(screen.getByRole('button', { name: /^monthly$/i }));

    // Pro monthly: effectiveMonthlyCents 24900 -> $249, straight from the map (no hardcoded price).
    expect(planCard('pro')).toHaveTextContent('$249');
    expect(planCard('pro')).not.toHaveTextContent('Price unavailable');
  });

  it('updates the displayed price when the cycle toggle changes', async () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    expect(planCard('starter')).toHaveTextContent('$74');

    await userEvent.click(screen.getByRole('button', { name: /^monthly$/i }));

    expect(planCard('starter')).toHaveTextContent('$99');
    expect(planCard('starter')).not.toHaveTextContent('Price unavailable');
  });

  it('shows a "save X%" clause only when the cycle is genuinely cheaper than monthly', async () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    // Yearly (default): 9900 -> 7417 is a real discount.
    expect(planCard('starter')).toHaveTextContent(/save \d+%/i);

    // Monthly vs itself: never a discount.
    await userEvent.click(screen.getByRole('button', { name: /^monthly$/i }));
    expect(planCard('starter')).not.toHaveTextContent(/save \d+%/i);
  });

  it('never renders a static hardcoded discount like (-10%) or (-25%)', () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    const toggle = screen.getByRole('group', { name: /billing cycle/i });
    expect(toggle).not.toHaveTextContent('-10%');
    expect(toggle).not.toHaveTextContent('-25%');
  });
});

// ── 4-tier grid: starter, growth, pro, enterprise ───────────────────────────

describe('SubscriptionTab — 4-tier plan grid', () => {
  it('renders exactly 4 plan cards: starter, growth, pro, enterprise', () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    expect(subscribeButton('starter')).toBeInTheDocument();
    expect(subscribeButton('growth')).toBeInTheDocument();
    expect(subscribeButton('pro')).toBeInTheDocument();
    expect(subscribeButton('enterprise')).toBeInTheDocument();
    // No 5th card and no leftover 'professional' key from the pre-rename lineup.
    expect(document.getElementById('plan-btn-professional')).not.toBeInTheDocument();
  });

  it('features growth with a "Popular" badge when the org has no current plan', () => {
    renderTab({ currentPlan: null, planPrices: fullPlanPrices() });

    const growthCard = planCard('growth');
    expect(growthCard).toHaveTextContent('Popular');
    expect(growthCard.className).toContain('bg-primary');

    // Every other card is neutral, not featured.
    expect(planCard('starter')).not.toHaveTextContent('Popular');
    expect(planCard('pro')).not.toHaveTextContent('Popular');
    expect(planCard('starter').className).not.toContain('bg-primary');
  });

  it('does not feature growth (no "bg-primary" emphasis) once the org already has a current plan', () => {
    renderTab({ currentPlan: 'starter', hasLiveSubscription: true, planPrices: fullPlanPrices() });

    // Still shows the "Popular" badge (badge is tied to plan.popular, not to
    // featured emphasis), but no longer gets the solid-brand featured card
    // styling — the subscribed plan takes the emphasis instead.
    expect(planCard('growth')).toHaveTextContent('Popular');
    expect(planCard('growth').className).not.toContain('bg-primary');
  });

  it('uses the growth plan key (not the legacy "professional" key) in the checkout payload', async () => {
    renderTab({ currentPlan: null, hasLiveSubscription: false });

    await userEvent.click(subscribeButton('growth'));

    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/billing/subscription/checkout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ planKey: 'growth', billingCycle: 'yearly' }),
      }),
    );
  });
});

// ── Scheduled-change banner (pending plan change) ───────────────────────────

describe('SubscriptionTab — scheduled-change banner', () => {
  it('renders the pending-change banner with the target plan and formatted effective date', () => {
    renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      scheduledPlanName: 'Starter',
      scheduledEffectiveAt: '2026-08-17T00:00:00.000Z',
    });

    expect(screen.getByText('Plan change scheduled')).toBeInTheDocument();
    expect(screen.getByText(/Changing to Starter on August 17, 2026/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel scheduled change' })).toBeInTheDocument();
  });

  it('does not render the banner when there is no pending scheduled change', () => {
    renderTab({ currentPlan: 'growth', hasLiveSubscription: true });

    expect(screen.queryByText('Plan change scheduled')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel scheduled change' }),
    ).not.toBeInTheDocument();
  });

  it('"Cancel scheduled change" calls the cancel-scheduled-change endpoint and navigates to Overview', async () => {
    const { fn, calls } = mockFetchRouter({ cancelScheduled: { success: true } });
    global.fetch = fn;

    const { props } = renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      scheduledPlanName: 'Starter',
      scheduledEffectiveAt: '2026-08-17T00:00:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel scheduled change' }));

    await waitFor(() => expect(props.onChangeTab).toHaveBeenCalledWith('overview'));
    expect(props.onMutated).toHaveBeenCalledOnce();
    expect(calls[0]!.url).toBe('/api/billing/subscription/cancel-scheduled-change');
  });

  it('surfaces an inline error when canceling the scheduled change fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'There is no scheduled plan change to cancel.' }),
    });

    const { props } = renderTab({
      currentPlan: 'growth',
      hasLiveSubscription: true,
      scheduledPlanName: 'Starter',
      scheduledEffectiveAt: '2026-08-17T00:00:00.000Z',
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel scheduled change' }));

    await screen.findByText(/no scheduled plan change to cancel/i);
    expect(props.onChangeTab).not.toHaveBeenCalled();
  });
});

/**
 * Team test 2026-09-03: the bottom of this tab was four sibling cards, each
 * carrying its own buttons, while the site-wide BillingPausedBanner added yet
 * another resume button above them — so a paused org saw two competing
 * controls. There is now exactly ONE control, whose menu follows the
 * subscription's status. (The banner's half of that fix is covered in
 * BillingPausedBanner.test.tsx.)
 */
describe('SubscriptionTab — the single status-aware "Update Plan" control', () => {
  const FUTURE = '2099-01-01T00:00:00.000Z';
  const PAST = '2020-01-01T00:00:00.000Z';

  async function openUpdatePlan() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /update plan/i }));
    return user;
  }

  function menuItemNames(): string[] {
    return screen.getAllByRole('menuitem').map((el) => el.textContent?.trim() ?? '');
  }

  it('offers Pause and Cancel while the subscription is simply active', async () => {
    renderTab({ currentPlan: 'pro', hasLiveSubscription: true, billingCycle: 'yearly' });

    await openUpdatePlan();

    expect(menuItemNames()).toEqual(['Pause', 'Cancel']);
  });

  it('offers Restart and Cancel while paused', async () => {
    renderTab({
      currentPlan: 'pro',
      hasLiveSubscription: true,
      pausedAt: PAST,
      pauseEndsAt: FUTURE,
    });

    expect(screen.getByText('Your subscription is paused')).toBeInTheDocument();
    await openUpdatePlan();

    expect(menuItemNames()).toEqual(['Restart', 'Cancel']);
  });

  it('offers Restart and Cancel once the pause has expired', async () => {
    renderTab({ currentPlan: 'pro', hasLiveSubscription: true, pausedAt: PAST, pauseEndsAt: PAST });

    expect(screen.getByText('Your pause has ended')).toBeInTheDocument();
    await openUpdatePlan();

    expect(menuItemNames()).toEqual(['Restart', 'Cancel']);
  });

  it('offers only Restart when a cancellation is already scheduled', async () => {
    renderTab({ currentPlan: 'pro', hasLiveSubscription: true, cancelAtPeriodEnd: true });

    expect(screen.getByText('Your subscription is scheduled to cancel')).toBeInTheDocument();
    await openUpdatePlan();

    expect(menuItemNames()).toEqual(['Restart']);
  });

  it('offers Cancel pause while a pause is scheduled but has not started', async () => {
    renderTab({ currentPlan: 'pro', hasLiveSubscription: true, pauseStartsAt: FUTURE });

    expect(screen.getByText('Pause scheduled')).toBeInTheDocument();
    await openUpdatePlan();

    expect(menuItemNames()).toEqual(['Cancel pause', 'Cancel']);
  });

  it('does not offer Cancel to a paused subscription that is already cancelling', async () => {
    renderTab({
      currentPlan: 'pro',
      hasLiveSubscription: true,
      pausedAt: PAST,
      pauseEndsAt: FUTURE,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: FUTURE,
    });

    await openUpdatePlan();

    // Cancelling twice is a no-op, so the option is withheld — but the pending
    // cancellation is still reported rather than hidden by the pause.
    expect(menuItemNames()).toEqual(['Restart']);
  });

  it('renders exactly one action control, with none of the old per-state buttons', () => {
    renderTab({
      currentPlan: 'pro',
      hasLiveSubscription: true,
      pausedAt: PAST,
      pauseEndsAt: FUTURE,
    });

    expect(screen.getAllByRole('button', { name: /update plan/i })).toHaveLength(1);
    for (const legacy of [/cancel or pause/i, /^continue plan$/i, /^resume subscription$/i]) {
      expect(screen.queryByRole('button', { name: legacy })).not.toBeInTheDocument();
    }
  });

  it('Restart resumes in place rather than navigating away', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderTab({
      currentPlan: 'pro',
      hasLiveSubscription: true,
      pausedAt: PAST,
      pauseEndsAt: FUTURE,
    });
    const user = await openUpdatePlan();
    await user.click(screen.getByRole('menuitem', { name: 'Restart' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('resume');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('Pause and Cancel hand off to the cancel page, which owns the confirmation flow', async () => {
    renderTab({ currentPlan: 'pro', hasLiveSubscription: true });

    const user = await openUpdatePlan();
    await user.click(screen.getByRole('menuitem', { name: 'Pause' }));

    expect(mockPush).toHaveBeenCalledWith('/dashboard/billing/cancel');
  });

  it('shows no control at all before the org has a plan', () => {
    renderTab({ currentPlan: null });

    expect(screen.queryByRole('button', { name: /update plan/i })).not.toBeInTheDocument();
  });
});
