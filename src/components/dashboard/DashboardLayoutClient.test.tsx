/**
 * Regression tests for the Billing nav-item gate in the dashboard sidebar,
 * plus the sidebar-redesign / Manage-Learn switcher changes: nav visibility is
 * now driven by the RBAC registry via `canAccessModule` (the Settings → Roles
 * matrix), Status Tracker lives in MAIN MENU (gated on `assignment.read`, so
 * finance is excluded), Help Center is universal (visible to every role,
 * including workers), so the SETTINGS section renders for everyone, and the mode
 * switcher stays manager-only (`isAdminRole`).
 *
 * The Billing gate resolves to `billing.read` — only `owner` and `finance` hold
 * that permission, so `supervisor` must no longer see the Billing nav entry even
 * though it still sees the (unrelated) admin-only PERFORMANCE section.
 *
 * `Header` and `SidebarModeSwitcher` are stubbed — they pull in notification
 * polling/actions and the `enterLearnMode` server action, both unrelated to
 * this component's own nav-visibility branching (each has its own test file).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/dashboard/Header', () => ({ default: () => null }));
vi.mock('@/components/dashboard/SidebarModeSwitcher', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="mode-switcher" data-mode={mode} />,
}));

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

describe('DashboardLayoutClient — SETTINGS section (universal Help Center) vs Settings link (owner-only)', () => {
  it('clinical_director (admin-tier, not owner, no billing.read) sees Help Center but neither Settings nor Billing', () => {
    renderLayout('clinical_director');

    expect(screen.getByRole('link', { name: /help center/i })).toHaveAttribute(
      'href',
      '/dashboard/help',
    );
    expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /billing/i })).not.toBeInTheDocument();
  });

  it('shows the universal Help Center for a worker role, but neither Settings nor Billing', () => {
    renderLayout('nurse');

    expect(screen.getByRole('link', { name: /help center/i })).toHaveAttribute(
      'href',
      '/dashboard/help',
    );
    expect(screen.queryByRole('link', { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /billing/i })).not.toBeInTheDocument();
  });

  it('hides the entire SETTINGS section when role is undefined', () => {
    renderLayout(undefined);

    expect(screen.queryByRole('link', { name: /help center/i })).not.toBeInTheDocument();
  });
});

describe('DashboardLayoutClient — Status Tracker moved into MAIN MENU', () => {
  it('places the Status Tracker link inside the MAIN MENU section, not PERFORMANCE', () => {
    renderLayout('owner');

    const mainMenuSection = screen.getByRole('heading', { name: /main menu/i }).closest('div');
    const performanceSection = screen.getByRole('heading', { name: /performance/i }).closest('div');

    expect(
      within(mainMenuSection!).getByRole('link', { name: /status tracker/i }),
    ).toBeInTheDocument();
    expect(
      within(performanceSection!).queryByRole('link', { name: /status tracker/i }),
    ).not.toBeInTheDocument();
  });

  it('hides Status Tracker for a worker role', () => {
    renderLayout('nurse');

    expect(screen.queryByRole('link', { name: /status tracker/i })).not.toBeInTheDocument();
  });
});

describe('DashboardLayoutClient — exact sidebar module set for all 5 manager roles + front_desk_admin worker', () => {
  // One explicit assertion block per role in the authoritative access matrix,
  // rather than the scattered spot-checks above. Audit Reports is included even
  // though it is not a NAVIGATION matrix row — the component gates it directly
  // on `auditPack.read`.
  const NAV_ITEM_NAMES = {
    Dashboard: /^dashboard$/i,
    Documents: /^documents$/i,
    Courses: /^courses$/i,
    'Status Tracker': /^status tracker$/i,
    'Staff Management': /^staff management$/i,
    'Audit Reports': /^audit reports$/i,
    Billing: /^billing$/i,
    Settings: /^settings$/i,
    'Help Center': /^help center$/i,
  } as const;

  type NavLabel = keyof typeof NAV_ITEM_NAMES;

  const ROLE_MODULE_MATRIX: Array<{ role: string; visible: NavLabel[] }> = [
    {
      role: 'owner',
      visible: [
        'Dashboard',
        'Documents',
        'Courses',
        'Status Tracker',
        'Staff Management',
        'Audit Reports',
        'Billing',
        'Settings',
        'Help Center',
      ],
    },
    {
      role: 'supervisor',
      visible: [
        'Dashboard',
        'Documents',
        'Courses',
        'Status Tracker',
        'Staff Management',
        'Audit Reports',
        'Help Center',
      ],
    },
    {
      role: 'hr',
      visible: [
        'Dashboard',
        'Documents',
        'Courses',
        'Status Tracker',
        'Staff Management',
        'Audit Reports',
        'Help Center',
      ],
    },
    {
      role: 'clinical_director',
      visible: [
        'Dashboard',
        'Documents',
        'Courses',
        'Status Tracker',
        'Staff Management',
        'Audit Reports',
        'Help Center',
      ],
    },
    {
      role: 'finance',
      visible: [
        'Dashboard',
        'Courses',
        'Staff Management',
        'Audit Reports',
        'Billing',
        'Help Center',
      ],
    },
    {
      role: 'front_desk_admin',
      visible: ['Dashboard', 'Courses', 'Help Center'],
    },
  ];

  it.each(ROLE_MODULE_MATRIX)(
    '$role renders exactly the expected module set',
    ({ role, visible }) => {
      renderLayout(role);

      for (const [label, name] of Object.entries(NAV_ITEM_NAMES) as [NavLabel, RegExp][]) {
        if (visible.includes(label)) {
          expect(
            screen.getByRole('link', { name }),
            `${role} should see ${label}`,
          ).toBeInTheDocument();
        } else {
          expect(
            screen.queryByRole('link', { name }),
            `${role} should NOT see ${label}`,
          ).not.toBeInTheDocument();
        }
      }
    },
  );
});

describe('DashboardLayoutClient — Manage/Learn mode switcher gate', () => {
  it.each(['owner', 'supervisor', 'hr', 'clinical_director', 'finance'])(
    'renders the switcher (in "manage" mode) for admin role %s',
    (role) => {
      renderLayout(role);

      expect(screen.getByTestId('mode-switcher')).toHaveAttribute('data-mode', 'manage');
    },
  );

  it('hides the switcher for a worker role', () => {
    renderLayout('nurse');

    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });

  it('hides the switcher when role is undefined', () => {
    renderLayout(undefined);

    expect(screen.queryByTestId('mode-switcher')).not.toBeInTheDocument();
  });
});
