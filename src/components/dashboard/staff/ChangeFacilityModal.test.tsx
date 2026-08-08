/**
 * Tests for ChangeFacilityModal — the two-step (select -> confirm) staff
 * facility-move flow driving setStaffFacilities(memberId, [singleFacilityId]).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSetStaffFacilities, mockRefresh } = vi.hoisted(() => ({
  mockSetStaffFacilities: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/app/actions/staff', () => ({ setStaffFacilities: mockSetStaffFacilities }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('next/image', () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import ChangeFacilityModal, { type ChangeFacilityMember } from './ChangeFacilityModal';

// jsdom has no ResizeObserver; Radix's RadioGroup (via useSize) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const MEMBER: ChangeFacilityMember = {
  id: 'ou-1',
  name: 'Ada Lovelace',
  email: 'ada@acme.com',
  avatarUrl: null,
  currentFacilityName: 'Alpha Site',
};

const FACILITIES = [
  { id: 'fac-1', name: 'Alpha Site', type: 'clinic', city: 'Austin' },
  { id: 'fac-2', name: 'Beta Site', type: 'clinic', city: 'Dallas' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(onClose = vi.fn()) {
  render(<ChangeFacilityModal isOpen onClose={onClose} member={MEMBER} facilities={FACILITIES} />);
  return { onClose };
}

describe('ChangeFacilityModal', () => {
  it('disables Continue until a target facility is selected', () => {
    renderModal();

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('moves through select -> confirm -> calls setStaffFacilities with exactly one facility id', async () => {
    const user = userEvent.setup();
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    renderModal();

    await user.click(screen.getByRole('radio', { name: /Beta Site/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByRole('button', { name: 'Switch facility' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch facility' }));

    expect(mockSetStaffFacilities).toHaveBeenCalledWith('ou-1', ['fac-2']);
  });

  it('closes and refreshes the page on a successful facility change', async () => {
    const user = userEvent.setup();
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    const { onClose } = renderModal();

    await user.click(screen.getByRole('radio', { name: /Beta Site/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Switch facility' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the server error and returns to the select step without closing, on failure', async () => {
    const user = userEvent.setup();
    mockSetStaffFacilities.mockResolvedValue({ success: false, error: 'Forbidden' });
    const { onClose } = renderModal();

    await user.click(screen.getByRole('radio', { name: /Beta Site/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Switch facility' }));

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    // Back on the select step (radio group + Continue button visible again).
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('lets Cancel from the confirm step return to select without submitting', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('radio', { name: /Beta Site/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(mockSetStaffFacilities).not.toHaveBeenCalled();
  });
});
