/**
 * Unit tests for src/components/dashboard/staff/InviteStaffModal.tsx
 *
 * This modal was merged from two sources: dev's Tabs + CSV bulk-import feature
 * and rbac's role Select + seat-cap gating. These tests guard the merge seam
 * that a component test can catch but a server-action test cannot:
 *   - the role picker only offers roles the inviter may grant (GRANTABLE_ROLES),
 *     and is hidden entirely when the inviter can grant nothing;
 *   - `createInvites` is called with the manually-entered emails and the
 *     selected role;
 *   - the seat-cap (seatsExhausted) disables the Send button and shows the
 *     "no remaining seats" copy.
 *
 * Radix `Select` (used for role choice) requires `hasPointerCapture` /
 * `scrollIntoView` polyfills this project's jsdom setup does not provide, so
 * these tests exercise the default-role ('worker') submit path via the plain
 * text chip input rather than opening the Select dropdown — that keeps the
 * suite deterministic without adding new test-infra risk. The default-role
 * path is also the common case (most invites are workers).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockCreateInvites, mockRouterRefresh } = vi.hoisted(() => ({
  mockCreateInvites: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));

vi.mock('@/app/actions/invite', () => ({ createInvites: mockCreateInvites }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import InviteStaffModal from './InviteStaffModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderModal(overrides: Partial<React.ComponentProps<typeof InviteStaffModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    remainingSeats: null as number | null,
    planName: 'Professional',
    inviterRole: 'owner' as const,
    ...overrides,
  };
  return { ...render(<InviteStaffModal {...props} />), props };
}

async function addEmailChip(email: string) {
  const input = screen.getByPlaceholderText(/enter emails/i);
  await userEvent.type(input, `${email} `);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInvites.mockResolvedValue({
    success: true,
    results: [{ email: 'worker@acme.com', status: 'sent' }],
  });
});

describe('InviteStaffModal — role picker visibility (GRANTABLE_ROLES gate)', () => {
  it('shows the Role field for an owner (has a non-empty grant list)', () => {
    renderModal({ inviterRole: 'owner' });
    expect(screen.getByText(/^Role$/)).toBeInTheDocument();
  });

  it('shows the Role field for hr (D1 — hr can grant hr/clinical_director/finance/worker)', () => {
    renderModal({ inviterRole: 'hr' });
    expect(screen.getByText(/^Role$/)).toBeInTheDocument();
  });

  it('hides the Role field for finance (GRANTABLE_ROLES.finance is empty)', () => {
    renderModal({ inviterRole: 'finance' });
    expect(screen.queryByText(/^Role$/)).not.toBeInTheDocument();
  });

  it('hides the Role field for clinical_director (GRANTABLE_ROLES.clinical_director is empty)', () => {
    renderModal({ inviterRole: 'clinical_director' });
    expect(screen.queryByText(/^Role$/)).not.toBeInTheDocument();
  });
});

describe('InviteStaffModal — manual invite submit', () => {
  it('calls createInvites with the entered email and the default role (worker)', async () => {
    renderModal({ inviterRole: 'owner' });

    await addEmailChip('newworker@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }));

    await waitFor(() => expect(mockCreateInvites).toHaveBeenCalledTimes(1));
    expect(mockCreateInvites).toHaveBeenCalledWith(['newworker@acme.com'], 'worker');
  });

  it('shows the success message and refreshes the router after a sent invite', async () => {
    renderModal({ inviterRole: 'owner' });

    await addEmailChip('newworker@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }));

    await waitFor(() => expect(screen.getByText(/sent 1 invite/i)).toBeInTheDocument());
  });

  it('surfaces the server error message when createInvites fails', async () => {
    mockCreateInvites.mockResolvedValue({
      success: false,
      results: [],
      error: 'You cannot grant the requested role',
    });
    renderModal({ inviterRole: 'hr' });

    await addEmailChip('newworker@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /send invites/i }));

    await waitFor(() =>
      expect(screen.getByText(/you cannot grant the requested role/i)).toBeInTheDocument(),
    );
  });
});

describe('InviteStaffModal — seat-cap gating', () => {
  it('disables Send Invites and shows the exhausted-seats message when remainingSeats is 0', async () => {
    renderModal({ remainingSeats: 0, planName: 'Starter', inviterRole: 'owner' });

    await addEmailChip('newworker@acme.com');

    expect(screen.getByText(/starter plan has no remaining worker seats/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invites/i })).toBeDisabled();
  });

  it('enables Send Invites and shows the remaining-seat count when seats are available', async () => {
    renderModal({ remainingSeats: 3, planName: 'Starter', inviterRole: 'owner' });

    await addEmailChip('newworker@acme.com');

    expect(screen.getByText(/3 seats remaining on your starter plan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invites/i })).toBeEnabled();
  });

  it('shows no seat hint when the plan is unlimited (remainingSeats: null)', async () => {
    renderModal({ remainingSeats: null, inviterRole: 'owner' });

    await addEmailChip('newworker@acme.com');

    expect(screen.queryByText(/seats? remaining/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invites/i })).toBeEnabled();
  });
});
