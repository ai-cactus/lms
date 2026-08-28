/**
 * Tests for BillingPausedBanner's session-only dismiss control (#30):
 * - the sessionStorage key is scoped to pauseState + pauseEndsAt, so a
 *   dismissal never outlives the specific pause instance it was for
 * - the `expired` variant renders no dismiss control at all — it is the only
 *   site-wide surface for that blocking continue-or-cancel decision
 * - a throwing sessionStorage (on read, and separately on write) fails safe:
 *   the banner stays visible rather than silently vanishing
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import BillingPausedBanner from './BillingPausedBanner';

/** Mirrors the component's own `dismissalKey` (not exported) to assert on storage. */
function dismissalKey(pauseState: string, pauseEndsAt: string | null): string {
  return `billing-paused-banner-dismissed:${pauseState}:${pauseEndsAt ?? 'open-ended'}`;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('BillingPausedBanner — dismiss key derivation (#30)', () => {
  it('stores the dismissal under a key scoped to pauseState and pauseEndsAt', async () => {
    const user = userEvent.setup();
    render(<BillingPausedBanner pauseState="paused" pauseEndsAt="2026-09-01T00:00:00.000Z" />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(sessionStorage.getItem(dismissalKey('paused', '2026-09-01T00:00:00.000Z'))).toBe('1');
  });

  it('does not pre-dismiss the expired banner after a paused dismissal', () => {
    sessionStorage.setItem(dismissalKey('paused', '2026-09-01T00:00:00.000Z'), '1');

    render(<BillingPausedBanner pauseState="expired" pauseEndsAt={null} />);

    expect(screen.getByText('Your subscription pause has ended')).toBeInTheDocument();
  });

  it('does not pre-dismiss a new pause with a different end date', () => {
    sessionStorage.setItem(dismissalKey('paused', '2026-09-01T00:00:00.000Z'), '1');

    render(<BillingPausedBanner pauseState="paused" pauseEndsAt="2026-10-15T00:00:00.000Z" />);

    expect(screen.getByText('Your subscription is paused')).toBeInTheDocument();
  });

  it('does not pre-dismiss a resume-then-repause with an open-ended new pause', () => {
    sessionStorage.setItem(dismissalKey('paused', '2026-09-01T00:00:00.000Z'), '1');

    render(<BillingPausedBanner pauseState="paused" pauseEndsAt={null} />);

    expect(screen.getByText('Your subscription is paused')).toBeInTheDocument();
  });

  it('honors an existing dismissal for the exact same pauseState and pauseEndsAt', () => {
    sessionStorage.setItem(dismissalKey('paused', '2026-09-01T00:00:00.000Z'), '1');

    render(<BillingPausedBanner pauseState="paused" pauseEndsAt="2026-09-01T00:00:00.000Z" />);

    expect(screen.queryByText('Your subscription is paused')).not.toBeInTheDocument();
  });
});

describe('BillingPausedBanner — expired variant is not dismissible (#30)', () => {
  it('renders no dismiss button while the rest of the banner is unchanged', () => {
    render(<BillingPausedBanner pauseState="expired" pauseEndsAt={null} />);

    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.getByText('Your subscription pause has ended')).toBeInTheDocument();
    expect(
      screen.getByText('Continue your plan to restore access, or cancel your subscription.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue Plan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel Plan' })).toHaveAttribute(
      'href',
      '/dashboard/billing/cancel',
    );
  });

  it('renders a dismiss button for the (dismissible) paused variant', () => {
    render(<BillingPausedBanner pauseState="paused" pauseEndsAt={null} />);

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});

describe('BillingPausedBanner — fails safe when sessionStorage throws (#30)', () => {
  it('stays visible when reading the dismissal throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    render(<BillingPausedBanner pauseState="paused" pauseEndsAt="2026-09-01T00:00:00.000Z" />);

    expect(screen.getByText('Your subscription is paused')).toBeInTheDocument();

    getItemSpy.mockRestore();
  });

  it('does not crash when persisting the dismissal throws, and recovers on the next mount', async () => {
    const user = userEvent.setup();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    const { unmount } = render(
      <BillingPausedBanner pauseState="paused" pauseEndsAt="2026-09-01T00:00:00.000Z" />,
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    unmount();

    // The failed write never actually landed, so a fresh mount (a reload or a
    // new tab) sees no persisted dismissal and shows the banner again — the
    // choice was never really saved.
    render(<BillingPausedBanner pauseState="paused" pauseEndsAt="2026-09-01T00:00:00.000Z" />);
    expect(screen.getByText('Your subscription is paused')).toBeInTheDocument();

    setItemSpy.mockRestore();
  });
});
