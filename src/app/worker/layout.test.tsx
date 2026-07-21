/**
 * Regression tests for the worker portal billing gate (TC-041-B).
 *
 * `WorkerLayout` (a Server Component run on every worker page) now fetches
 * the org's subscription and renders `WorkerBillingBlockedScreen` IN PLACE
 * (never a redirect, to avoid looping with the login guard) whenever
 * `hasActiveBilling()` is false — a paused subscription, a non-active status,
 * or an org with no subscription row at all. This mirrors the exact
 * semantics of the assignment gate (`src/app/actions/enrollment.ts`) so the
 * worker portal and assignment gating can never disagree.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    profile: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth.worker', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => `masked:${e}`,
}));
vi.mock('@/components/providers/WorkerSessionProvider', () => ({
  WorkerSessionProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-provider">{children}</div>
  ),
}));
vi.mock('@/components/worker/WorkerDashboardLayout', () => ({
  default: ({ children, fullName }: { children: React.ReactNode; fullName: string }) => (
    <div data-testid="worker-dashboard">
      {fullName}
      {children}
    </div>
  ),
}));

import WorkerLayout from './layout';

const SESSION = { user: { id: 'user-1', email: 'worker@acme.com', name: 'Worker One' } };
const ACTIVE_SUB = { status: 'active', pausedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION);
  prismaMock.profile.findUnique.mockResolvedValue({ fullName: 'Worker One' });
  prismaMock.user.findUnique.mockResolvedValue({
    organizationId: 'org-1',
    role: 'nurse',
    organization: { subscription: ACTIVE_SUB },
  });
});

describe('WorkerLayout — billing gate (TC-041-B)', () => {
  it('renders the portal when the org has active billing', async () => {
    const element = await WorkerLayout({ children: <div data-testid="page-content" /> });
    render(element);

    expect(screen.getByTestId('worker-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByText(/training temporarily unavailable/i)).not.toBeInTheDocument();
  });

  it('renders the blocked screen (not the portal) when the subscription is paused', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      role: 'nurse',
      organization: { subscription: { status: 'active', pausedAt: new Date('2026-06-01') } },
    });

    const element = await WorkerLayout({ children: <div data-testid="page-content" /> });
    render(element);

    expect(screen.getByText(/training temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.queryByTestId('worker-dashboard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it.each(['past_due', 'canceled', 'incomplete'])(
    'renders the blocked screen for a non-active subscription status (%s)',
    async (status) => {
      prismaMock.user.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        role: 'nurse',
        organization: { subscription: { status, pausedAt: null } },
      });

      const element = await WorkerLayout({ children: <div /> });
      render(element);

      expect(screen.getByText(/training temporarily unavailable/i)).toBeInTheDocument();
    },
  );

  it('renders the blocked screen when the org has no subscription row at all', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      role: 'nurse',
      organization: { subscription: null },
    });

    const element = await WorkerLayout({ children: <div /> });
    render(element);

    expect(screen.getByText(/training temporarily unavailable/i)).toBeInTheDocument();
  });

  it('treats trialing as active (not blocked)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      organizationId: 'org-1',
      role: 'nurse',
      organization: { subscription: { status: 'trialing', pausedAt: null } },
    });

    const element = await WorkerLayout({ children: <div data-testid="page-content" /> });
    render(element);

    expect(screen.getByTestId('page-content')).toBeInTheDocument();
  });

  it('redirects to /onboarding-worker before the billing check when the user has no organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      organizationId: null,
      role: 'nurse',
      organization: null,
    });

    await expect(WorkerLayout({ children: <div /> })).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/onboarding-worker');
  });

  it('redirects to /login when there is no session, before any billing lookup', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(WorkerLayout({ children: <div /> })).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('masks the email in the render log line (PII rule)', async () => {
    await WorkerLayout({ children: <div /> });

    const { logger } = await import('@/lib/logger');
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'masked:worker@acme.com' }),
      }),
    );
  });
});
