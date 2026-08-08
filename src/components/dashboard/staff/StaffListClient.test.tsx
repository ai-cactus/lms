/**
 * Regression tests for the RBAC permission gate on the "Add Staff" affordance.
 *
 * `StaffListClient` now hides the "Add Staff" button (and skips mounting
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
import userEvent from '@testing-library/user-event';
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
      viewerOrganizationUserId="ou-viewer"
      facilities={[]}
    />,
  );
}

function memberEntry(id: string, name: string, role = 'hr') {
  return {
    id,
    name,
    email: `${id}@acme.test`,
    avatarUrl: null,
    role,
    jobTitle: 'Coordinator',
    dateInvited: new Date('2026-01-01'),
    isPending: false,
    isExpired: false,
    token: null,
    facilities: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StaffListClient — Add Staff visibility (invite.create gate)', () => {
  // admin is Owner-equivalent (`everything` permission set) per the RBAC ruling.
  it.each<Role>(['owner', 'admin', 'hr'])(
    'shows Add Staff and mounts InviteStaffModal for %s',
    (role) => {
      renderList(role);

      expect(screen.getByRole('button', { name: /add staff/i })).toBeInTheDocument();
      expect(screen.getByTestId('invite-staff-modal')).toBeInTheDocument();
    },
  );

  // supervisor was demoted to read-only-plus-self-service under the RBAC
  // ruling bundled with the multi-org refactor — it no longer holds
  // `invite.create` (previously mirrored owner's grant set).
  it('hides Add Staff for supervisor (demoted to read-only, no invite.create)', () => {
    renderList('supervisor');

    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-staff-modal')).not.toBeInTheDocument();
  });

  it('hides Add Staff for finance (no invite.create permission)', () => {
    renderList('finance');

    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-staff-modal')).not.toBeInTheDocument();
  });

  it('hides Add Staff for a worker role (nurse)', () => {
    renderList('nurse');

    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-staff-modal')).not.toBeInTheDocument();
  });

  it('hides Add Staff for clinical_director (no invite.create permission)', () => {
    renderList('clinical_director');

    expect(screen.queryByRole('button', { name: /add staff/i })).not.toBeInTheDocument();
  });
});

describe('StaffListClient — Remove Staff never offered on the viewer’s own row', () => {
  it('offers Remove Staff for other members but not for the viewer themselves', async () => {
    const user = userEvent.setup();
    render(
      <StaffListClient
        users={[memberEntry('ou-viewer', 'Self Admin'), memberEntry('ou-other', 'Other Member')]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={2}
        pendingInviteCount={0}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
      />,
    );

    const menus = screen.getAllByRole('button', { name: 'Row actions' });
    expect(menus).toHaveLength(2);

    // Row order matches the users prop: index 0 is the viewer's own row.
    await user.click(menus[0]);
    expect(screen.queryByRole('menuitem', { name: /remove staff/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /view profile/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(menus[1]);
    expect(screen.getByRole('menuitem', { name: /remove staff/i })).toBeInTheDocument();
  });

  it('never offers Remove Staff or Change Facility on the owner row', async () => {
    const user = userEvent.setup();
    render(
      <StaffListClient
        users={[memberEntry('ou-owner', 'The Owner', 'owner'), memberEntry('ou-hr', 'HR Person')]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={2}
        pendingInviteCount={0}
        inviterRole="admin"
        viewerOrganizationUserId="ou-admin-viewer"
        facilities={[{ id: 'fac-1', name: 'Main Site', type: null, city: null }]}
      />,
    );

    const menus = screen.getAllByRole('button', { name: 'Row actions' });

    await user.click(menus[0]);
    expect(screen.queryByRole('menuitem', { name: /remove staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /change facility/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /view profile/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(menus[1]);
    expect(screen.getByRole('menuitem', { name: /remove staff/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change facility/i })).toBeInTheDocument();
  });
});
