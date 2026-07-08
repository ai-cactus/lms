/**
 * Unit tests for src/components/dashboard/staff/InviteStaffModal.tsx
 *
 * The modal is a two-step flow: step 1 collects emails (textarea + CSV upload),
 * step 2 assigns a role to each parsed contact, then `createInvites(items)` runs
 * and a success screen is shown. These tests guard the seams a component test
 * can catch:
 *   - step 1 → step 2 navigation is gated on at least one valid parsed email;
 *   - the back-chevron returns to step 1 preserving the typed input;
 *   - the seat-cap (seatsExhausted) disables Continue and shows the
 *     "no remaining seats" copy.
 *
 * The grouped role `Select` (Radix) requires `hasPointerCapture` /
 * `scrollIntoView` polyfills this project's jsdom setup does not provide, so
 * these tests stop short of opening the dropdown to assign a role. Full
 * happy-path coverage (assign → submit → success) is owned by bug-hunter's
 * e2e/integration suite.
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

function emailTextarea() {
  return screen.getByPlaceholderText(/enter emails separated by/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInvites.mockResolvedValue({
    success: true,
    results: [{ email: 'worker@acme.com', status: 'sent' }],
  });
});

describe('InviteStaffModal — step 1 email entry', () => {
  it('renders the "Invite New Staffs" step with the email textarea', () => {
    renderModal();
    expect(screen.getByText('Invite New Staffs')).toBeInTheDocument();
    expect(emailTextarea()).toBeInTheDocument();
  });

  it('keeps Continue disabled until at least one valid email is parsed', async () => {
    renderModal();
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    expect(continueBtn).toBeDisabled();

    await userEvent.type(emailTextarea(), 'not-an-email');
    expect(continueBtn).toBeDisabled();

    await userEvent.clear(emailTextarea());
    await userEvent.type(emailTextarea(), 'newworker@acme.com');
    expect(continueBtn).toBeEnabled();
  });

  it('advances to the Assign roles step showing the parsed contact count', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com, b@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();
    expect(screen.getByText(/2 contacts found/i)).toBeInTheDocument();
  });
});

describe('InviteStaffModal — step navigation', () => {
  it('returns to step 1 preserving the typed emails when the back chevron is clicked', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'keep@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));

    expect(screen.getByText('Invite New Staffs')).toBeInTheDocument();
    expect(emailTextarea()).toHaveValue('keep@acme.com');
  });

  it('keeps the step-2 Continue disabled until every contact has a role', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    // On step 2 the contact still has no role assigned → Continue disabled.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});

describe('InviteStaffModal — seat-cap gating', () => {
  it('disables Continue and shows the exhausted-seats message when remainingSeats is 0', async () => {
    renderModal({ remainingSeats: 0, planName: 'Starter' });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.getByText(/starter plan has no remaining worker seats/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('enables Continue and shows the remaining-seat count when seats are available', async () => {
    renderModal({ remainingSeats: 3, planName: 'Starter' });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.getByText(/3 seats remaining on your starter plan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('shows no seat hint when the plan is unlimited (remainingSeats: null)', async () => {
    renderModal({ remainingSeats: null });

    await userEvent.type(emailTextarea(), 'newworker@acme.com');

    expect(screen.queryByText(/seats? remaining/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});

describe('InviteStaffModal — no-op guard', () => {
  it('does not call createInvites while roles are unassigned', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step-2 Continue is disabled, so the action is never reached.
    await waitFor(() => expect(screen.getByText('Assign roles')).toBeInTheDocument());
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });
});
