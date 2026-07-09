/**
 * Regression tests for the worker sidebar's Manage/Learn switcher gate and the
 * always-present Help Center link, introduced alongside the session-bridge
 * feature. The switcher must only appear for an admin-tier user who bridged
 * into learner mode (role is still their real admin role on the worker
 * cookie) — a genuine worker role, or an unresolved role, must never see it.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/worker' }));
vi.mock('@/components/worker/WorkerHeader', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SidebarModeSwitcher', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="mode-switcher" data-mode={mode} />,
}));

import WorkerDashboardLayout from './WorkerDashboardLayout';

function renderLayout(role: string | undefined) {
  return render(
    <WorkerDashboardLayout fullName="Nina Nurse" role={role}>
      <div>content</div>
    </WorkerDashboardLayout>,
  );
}

describe('WorkerDashboardLayout — mode switcher gate', () => {
  it('shows the switcher (in "learn" mode) for a bridged admin-tier role', () => {
    renderLayout('owner');

    const switcher = screen.getByTestId('mode-switcher');
    expect(switcher).toHaveAttribute('data-mode', 'learn');
  });

  it('hides the switcher for a genuine worker role (nurse)', () => {
    renderLayout('nurse');

    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });

  it('hides the switcher when role is undefined', () => {
    renderLayout(undefined);

    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });
});

describe('WorkerDashboardLayout — HELP section', () => {
  it.each(['nurse', 'owner', undefined])(
    'always shows the Help Center link regardless of role (%s)',
    (role) => {
      renderLayout(role);

      expect(screen.getByRole('link', { name: /help center/i })).toHaveAttribute(
        'href',
        '/worker/help',
      );
    },
  );
});
