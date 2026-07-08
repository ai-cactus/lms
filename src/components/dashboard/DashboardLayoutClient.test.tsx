/**
 * Regression tests for the Billing nav-item gate in the dashboard sidebar.
 *
 * The gate switched from `isAdminRole(role)` (true for supervisor too) to
 * `can(dbRoleToRoleKey(role), 'billing.read')` — only `owner` and `finance`
 * hold that permission, so `supervisor` must no longer see the Billing nav
 * entry even though it still sees the (unrelated) admin-only PERFORMANCE
 * section.
 *
 * `Header` is stubbed — it pulls in notification polling/actions unrelated to
 * this component's own nav-visibility branching.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/components/dashboard/Header', () => ({ default: () => null }));

import DashboardLayoutClient from './DashboardLayoutClient';

function renderLayout(role: string | undefined) {
  return render(
    <DashboardLayoutClient userEmail="user@acme.com" fullName="Jane Doe" role={role}>
      <div>content</div>
    </DashboardLayoutClient>,
  );
}

describe('DashboardLayoutClient — Billing nav gate (billing.read)', () => {
  it.each(['owner', 'finance'])('shows the Billing nav link for %s', (role) => {
    renderLayout(role);

    expect(screen.getByRole('link', { name: /billing/i })).toBeInTheDocument();
  });

  it('hides the Billing nav link for supervisor', () => {
    renderLayout('supervisor');

    expect(screen.queryByRole('link', { name: /billing/i })).not.toBeInTheDocument();
    // Sanity check the two gates are independent: supervisor is still an admin
    // role, so it should still see the unrelated admin-only section.
    expect(screen.getByRole('link', { name: /staff management/i })).toBeInTheDocument();
  });

  it('hides the Billing nav link when role is undefined', () => {
    renderLayout(undefined);

    expect(screen.queryByRole('link', { name: /billing/i })).not.toBeInTheDocument();
  });
});

describe('DashboardLayoutClient — Settings nav gate (owner-only)', () => {
  it('shows the Settings nav link for owner', () => {
    renderLayout('owner');

    expect(screen.getByRole('link', { name: /^settings$/i })).toBeInTheDocument();
  });

  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'hides the Settings nav link for %s',
    (role) => {
      renderLayout(role);

      expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument();
    },
  );

  it('hides the Settings nav link for a worker role (nurse)', () => {
    renderLayout('nurse');

    expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument();
  });

  it('still shows Billing for finance even though Settings is hidden (independent gates)', () => {
    renderLayout('finance');

    expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /billing/i })).toBeInTheDocument();
  });
});
