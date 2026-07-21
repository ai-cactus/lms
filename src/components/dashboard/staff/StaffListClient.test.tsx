/**
 * Regression tests for the RBAC permission gate on the "Add Workers" affordance.
 *
 * `StaffListClient` now hides the "Add Workers" button (and skips mounting
 * `InviteStaffModal` entirely) for any inviter role that lacks `invite.create`
 * — the server route still enforces this independently, but the UI must not
 * offer a dead-end action to roles like `finance` or any worker role.
 *
 * Heavy child modals (`InviteStaffModal`, `OrganizationActivationModal`,
 * `RevokeInviteModal`, `RemoveStaffModal`, `WorkerLimitModal`) are stubbed —
 * they have their own dedicated tests and are irrelevant to the gate under
 * test here.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Role } from '@/types/next-auth';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('@/app/actions/staff', () => ({
  generateStaffActivityPdfAndEmail: vi.fn(),
  resendInvite: vi.fn(),
}));
vi.mock('@/components/dashboard/OrganizationActivationModal', () => ({
  default: () => null,
}));
vi.mock('./InviteStaffModal', () => ({
  default: () => <div data-testid="invite-staff-modal" />,
}));
vi.mock('./RevokeInviteModal', () => ({ default: () => null }));
vi.mock('./RemoveStaffModal', () => ({ default: () => null }));
vi.mock('./WorkerLimitModal', () => ({ default: () => null }));

import StaffListClient from './StaffListClient';

function renderList(inviterRole: Role) {
  return render(
    <StaffListClient
      users={[]}
      hasOrganization={true}
      organizationId="org-1"
      planLimit={null}
      planName="Professional"
      currentWorkerCount={0}
      pendingInviteCount={0}
      inviterRole={inviterRole}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StaffListClient — Add Workers visibility (invite.create gate)', () => {
  it.each<Role>(['owner', 'supervisor', 'hr'])(
    'shows Add Workers and mounts InviteStaffModal for %s',
    (role) => {
      renderList(role);

      expect(screen.getByRole('button', { name: /add workers/i })).toBeInTheDocument();
      expect(screen.getByTestId('invite-staff-modal')).toBeInTheDocument();
    },
  );

  it('hides Add Workers for finance (no invite.create permission)', () => {
    renderList('finance');

    expect(screen.queryByRole('button', { name: /add workers/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-staff-modal')).not.toBeInTheDocument();
  });

  it('hides Add Workers for a worker role (nurse)', () => {
    renderList('nurse');

    expect(screen.queryByRole('button', { name: /add workers/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-staff-modal')).not.toBeInTheDocument();
  });

  it('hides Add Workers for clinical_director (no invite.create permission)', () => {
    renderList('clinical_director');

    expect(screen.queryByRole('button', { name: /add workers/i })).not.toBeInTheDocument();
  });
});
