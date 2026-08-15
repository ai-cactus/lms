/**
 * Unit tests for src/components/dashboard/staff/InviteStaffModal.tsx
 *
 * The modal is a three-step flow: step 1 picks the target facility and collects
 * emails (textarea + CSV upload), step 2 assigns a role to each parsed contact,
 * then `createInvites(items, { facilityId })` runs and a success screen is
 * shown. These tests guard the seams a component test can catch:
 *   - step 1 → step 2 navigation is gated on a chosen facility AND at least one
 *     valid parsed email;
 *   - "Global" submits an explicit `facilityId: null` (skip the inviter-facility
 *     fallback) while a named facility submits its id;
 *   - the back-chevron returns to step 1 preserving the typed input;
 *   - the seat-cap (seatsExhausted) disables Continue and shows the
 *     "no remaining seats" copy.
 *
 * Radix `Select` needs `hasPointerCapture` / `scrollIntoView` / `ResizeObserver`,
 * none of which jsdom provides — they are stubbed below so the facility and role
 * dropdowns can actually be driven.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
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

// ── jsdom stubs Radix Select depends on ───────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const FACILITIES = [
  { id: 'fac-1', name: 'Northside Clinic', type: 'Behavioral Health', city: 'Denver, CO' },
  { id: 'fac-2', name: 'Lakeside Pediatrics', type: 'Behavioral Health', city: 'Denver, CO' },
];

function renderModal(overrides: Partial<React.ComponentProps<typeof InviteStaffModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    remainingSeats: null as number | null,
    planName: 'Professional',
    inviterRole: 'owner' as const,
    facilities: FACILITIES,
    ...overrides,
  };
  return { ...render(<InviteStaffModal {...props} />), props };
}

function emailTextarea() {
  return screen.getByPlaceholderText(/enter emails separated by/i);
}

/** Opens the Facility dropdown and picks the option whose label matches. */
async function chooseFacility(label: string | RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Facility' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

/** Assigns the same role to every contact via the "Set every role to" select. */
async function setEveryRoleTo(roleLabel: string) {
  const row = screen.getByText('Set every role to').closest('div') as HTMLElement;
  await userEvent.click(within(row).getByRole('combobox'));
  await userEvent.click(await screen.findByRole('option', { name: roleLabel }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateInvites.mockResolvedValue({
    success: true,
    results: [{ email: 'worker@acme.com', status: 'sent' }],
  });
});

describe('InviteStaffModal — step 1 facility + email entry', () => {
  it('renders the "Invite New Staffs" step with the facility select above the email textarea', () => {
    renderModal();
    expect(screen.getByText('Invite New Staffs')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Facility' })).toBeInTheDocument();
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

  it('blocks Continue with a field error while no facility has been chosen', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText(/select a facility before continuing/i)).toBeInTheDocument();
    expect(screen.queryByText('Assign roles')).not.toBeInTheDocument();
  });

  it('clears the facility error and advances once a facility is chosen', async () => {
    renderModal();
    await userEvent.type(emailTextarea(), 'a@acme.com, b@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByText(/select a facility before continuing/i)).toBeInTheDocument();

    await chooseFacility(/Northside Clinic/);
    expect(screen.queryByText(/select a facility before continuing/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();
    expect(screen.getByText(/2 contacts found/i)).toBeInTheDocument();
  });
});

describe('InviteStaffModal — step navigation', () => {
  it('returns to step 1 preserving the typed emails when the back chevron is clicked', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'keep@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText('Assign roles')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /back to email entry/i }));

    expect(screen.getByText('Invite New Staffs')).toBeInTheDocument();
    // The email was committed to a chip (with its remove button) when focus left
    // the input on Continue — the chip must survive the round-trip to step 2.
    expect(screen.getByText('keep@acme.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove keep@acme.com' })).toBeInTheDocument();
  });

  it('keeps the step-2 "Invite N staffs" CTA disabled until every contact has a role', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    // On step 2 the contact still has no role assigned → the CTA stays disabled.
    expect(screen.getByRole('button', { name: 'Invite 1 staff' })).toBeDisabled();
  });
});

describe('InviteStaffModal — facility passed to createInvites', () => {
  it('submits an explicit null facilityId for the Global option', async () => {
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com, b@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    await setEveryRoleTo('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 2 staffs' }));

    await waitFor(() =>
      expect(mockCreateInvites).toHaveBeenCalledWith(
        [
          { email: 'a@acme.com', role: 'hr' },
          { email: 'b@acme.com', role: 'hr' },
        ],
        { facilityId: null },
      ),
    );
  });

  it('submits the chosen facility id for a named facility', async () => {
    renderModal();
    await chooseFacility(/Lakeside Pediatrics/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    await setEveryRoleTo('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 1 staff' }));

    await waitFor(() =>
      expect(mockCreateInvites).toHaveBeenCalledWith([{ email: 'a@acme.com', role: 'hr' }], {
        facilityId: 'fac-2',
      }),
    );
  });

  it('shows the success step copy and the Okay button once the invites are sent', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [{ email: 'a@acme.com', status: 'sent' }],
    });
    renderModal();
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    await setEveryRoleTo('HR');
    await userEvent.click(screen.getByRole('button', { name: 'Invite 1 staff' }));

    expect(await screen.findByText('Invite sent')).toBeInTheDocument();
    expect(screen.getByText(/1 staff invited\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Okay' })).toBeInTheDocument();
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
    await chooseFacility(/^Global/);
    await userEvent.type(emailTextarea(), 'a@acme.com');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    // The step-2 CTA is disabled, so the action is never reached.
    await waitFor(() => expect(screen.getByText('Assign roles')).toBeInTheDocument());
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });
});
