/**
 * Tests for `StaffListClient` — the RBAC permission gates on the roster's
 * affordances plus the toolbar's search/role filtering.
 *
 * The list hides "Add Staff" (and skips mounting `InviteStaffModal` entirely)
 * for any inviter role that lacks `invite.create` — the server route still
 * enforces this independently, but the UI must not offer a dead-end action to
 * roles like `finance` or any worker role.
 *
 * Per the Figma roster design the row kebab carries only Change Facility and
 * Remove Staff; opening a profile is the row click itself, so there is no
 * redundant "View profile" link. A row whose viewer holds neither mutating
 * action therefore has no kebab at all.
 *
 * Heavy child modals (`InviteStaffModal`, `OrganizationActivationModal`,
 * `RevokeInviteModal`, `RemoveStaffModal`, `WorkerLimitModal`) are stubbed —
 * they have their own dedicated tests and are irrelevant to the gates under
 * test here.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Role } from '@/types/next-auth';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
vi.mock('@/app/actions/staff', () => ({
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

// jsdom stubs Radix Select depends on (the role filter + "Show N entries").
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

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

/** The row whose visible text contains `text` (skips the header row). */
function rowFor(text: string) {
  return screen.getByText(text).closest('tr') as HTMLElement;
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

    // With no facilities to move between, Remove Staff is the row menu's only
    // possible action — so the viewer's own row has no kebab at all.
    expect(
      within(rowFor('Self Admin')).queryByRole('button', { name: 'Row actions' }),
    ).not.toBeInTheDocument();

    await user.click(within(rowFor('Other Member')).getByRole('button', { name: 'Row actions' }));
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

    // The owner row is immutable, so neither kebab action survives its gates.
    expect(
      within(rowFor('The Owner')).queryByRole('button', { name: 'Row actions' }),
    ).not.toBeInTheDocument();

    await user.click(within(rowFor('HR Person')).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: /remove staff/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change facility/i })).toBeInTheDocument();
  });
});

describe('StaffListClient — row Action cell (Figma roster design)', () => {
  it('labels the columns as the design does', () => {
    render(
      <StaffListClient
        users={[memberEntry('ou-hr', 'HR Person')]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={1}
        pendingInviteCount={0}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
      />,
    );

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Role',
      'Facility',
      'Date Added',
      'Action',
    ]);
  });

  it('opens the profile from the row itself and keeps the kebab to the two design actions', async () => {
    const user = userEvent.setup();
    render(
      <StaffListClient
        users={[memberEntry('ou-hr', 'HR Person')]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={1}
        pendingInviteCount={0}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[{ id: 'fac-1', name: 'Main Site', type: null, city: null }]}
      />,
    );

    expect(screen.queryByRole('link', { name: 'View profile' })).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    const [dataRow] = within(table).getAllByRole('row').slice(1);
    await user.click(dataRow);
    expect(mockPush).toHaveBeenCalledWith('/dashboard/staff/ou-hr');

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Change Facility', 'Remove Staff']);
  });

  it('does not navigate from a pending-invite row but keeps its invite actions', async () => {
    const user = userEvent.setup();
    render(
      <StaffListClient
        users={[
          {
            ...memberEntry('inv-1', ''),
            email: 'invitee@acme.test',
            isPending: true,
            token: 'tok',
          },
        ]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={0}
        pendingInviteCount={1}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[{ id: 'fac-1', name: 'Main Site', type: null, city: null }]}
      />,
    );

    const table = screen.getByRole('table');
    const [dataRow] = within(table).getAllByRole('row').slice(1);
    await user.click(dataRow);
    expect(mockPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Resend Invite' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy invite link' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Revoke Invite' })).toBeInTheDocument();
  });
});

describe('StaffListClient — All Staff role filter', () => {
  const roster = [
    memberEntry('ou-hr', 'Hilda Reyes', 'hr'),
    memberEntry('ou-nurse-1', 'Nadia Okoye', 'nurse'),
    memberEntry('ou-nurse-2', 'Noah Brandt', 'nurse'),
  ];

  function renderRoster() {
    return render(
      <StaffListClient
        users={roster}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={3}
        pendingInviteCount={0}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
      />,
    );
  }

  /** Picks an option from the role filter by its display-name label. */
  async function chooseRole(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await user.click(await screen.findByRole('option', { name: label }));
  }

  it('offers only the roles present in the roster, deduplicated', async () => {
    const user = userEvent.setup();
    renderRoster();

    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['All Staff', 'HR', 'Nurse']);
  });

  it('narrows the table to the chosen role and back again', async () => {
    const user = userEvent.setup();
    renderRoster();

    await chooseRole(user, 'Nurse');
    expect(screen.getByText('Nadia Okoye')).toBeInTheDocument();
    expect(screen.getByText('Noah Brandt')).toBeInTheDocument();
    expect(screen.queryByText('Hilda Reyes')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 2 of 2 entries')).toBeInTheDocument();

    await chooseRole(user, 'All Staff');
    expect(screen.getByText('Hilda Reyes')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 3 of 3 entries')).toBeInTheDocument();
  });

  it('resets to page 1 when the role changes', async () => {
    const user = userEvent.setup();
    render(
      <StaffListClient
        users={[
          ...Array.from({ length: 12 }, (_, i) => memberEntry(`ou-n-${i}`, `Nurse ${i}`, 'nurse')),
          memberEntry('ou-hr', 'Hilda Reyes', 'hr'),
        ]}
        hasOrganization={true}
        organizationId="org-1"
        planLimit={null}
        planName="Professional"
        currentWorkerCount={13}
        pendingInviteCount={0}
        inviterRole="owner"
        viewerOrganizationUserId="ou-viewer"
        facilities={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Showing 11 to 13 of 13 entries')).toBeInTheDocument();

    await chooseRole(user, 'Nurse');
    expect(screen.getByText('Showing 1 to 10 of 12 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });

  it('applies the role filter alongside the search box', async () => {
    const user = userEvent.setup();
    renderRoster();

    await chooseRole(user, 'Nurse');
    await user.type(screen.getByRole('searchbox', { name: 'Search staff' }), 'Nadia');

    expect(screen.getByText('Nadia Okoye')).toBeInTheDocument();
    expect(screen.queryByText('Noah Brandt')).not.toBeInTheDocument();
    expect(screen.queryByText('Hilda Reyes')).not.toBeInTheDocument();
  });
});
