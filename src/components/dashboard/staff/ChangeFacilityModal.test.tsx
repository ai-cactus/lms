/**
 * Tests for ChangeFacilityModal — the two-step (select -> confirm) facility
 * editor. It always sends the member's FULL intended facility set to
 * setStaffFacilities, so a member of several facilities is never collapsed to one.
 */
import { render, screen, within } from '@testing-library/react';
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

// jsdom has no ResizeObserver; Radix's Checkbox (via useSize) needs one to mount.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const ALPHA = { id: 'fac-1', name: 'Alpha Site' };
const BETA = { id: 'fac-2', name: 'Beta Site' };

const MEMBER: ChangeFacilityMember = {
  id: 'ou-1',
  name: 'Ada Lovelace',
  email: 'ada@acme.com',
  avatarUrl: null,
  currentFacilities: [ALPHA],
};

const FACILITIES = [
  { id: 'fac-1', name: 'Alpha Site', type: 'clinic', city: 'Austin' },
  { id: 'fac-2', name: 'Beta Site', type: 'clinic', city: 'Dallas' },
  { id: 'fac-3', name: 'Gamma Site', type: 'clinic', city: 'Houston' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderModal(
  member: ChangeFacilityMember = MEMBER,
  facilities = FACILITIES,
  onClose = vi.fn(),
) {
  render(<ChangeFacilityModal isOpen onClose={onClose} member={member} facilities={facilities} />);
  return { onClose };
}

const box = (name: RegExp) => screen.getByRole('checkbox', { name });
const reviewButton = () => screen.getByRole('button', { name: 'Review changes' });

describe('ChangeFacilityModal — select step', () => {
  it('renders a "Facilities" checkbox group with the member current facilities pre-checked', () => {
    renderModal({ ...MEMBER, currentFacilities: [ALPHA, BETA] });

    const group = screen.getByRole('group', { name: 'Facilities' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    expect(box(/Alpha Site/)).toBeChecked();
    expect(box(/Beta Site/)).toBeChecked();
    expect(box(/Gamma Site/)).not.toBeChecked();
    expect(screen.getByText(/Current · Alpha Site, Beta Site/)).toBeInTheDocument();
  });

  it('summarises the current facilities as a count once the member is in more than two', () => {
    renderModal({
      ...MEMBER,
      currentFacilities: [ALPHA, BETA, { id: 'fac-3', name: 'Gamma Site' }],
    });

    expect(screen.getByText(/Current · 3 facilities/)).toBeInTheDocument();
  });

  it('disables Review changes while nothing has changed', () => {
    renderModal();

    expect(reviewButton()).toBeDisabled();
  });

  it('disables Review changes when every facility is unchecked', async () => {
    renderModal();

    await userEvent.click(box(/Alpha Site/));

    expect(box(/Alpha Site/)).not.toBeChecked();
    expect(reviewButton()).toBeDisabled();
  });

  it('enables Review changes once a facility is added, and disables it again when the change is undone', async () => {
    renderModal();

    await userEvent.click(box(/Beta Site/));
    expect(reviewButton()).toBeEnabled();

    await userEvent.click(box(/Beta Site/));
    expect(reviewButton()).toBeDisabled();
  });
});

describe('ChangeFacilityModal — confirm step and payload', () => {
  it('lists what is being added and removed, and names the Update facilities action', async () => {
    renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(box(/Alpha Site/));
    await userEvent.click(reviewButton());

    expect(screen.getByText('Adding:').parentElement).toHaveTextContent('Adding: Beta Site');
    expect(screen.getByText('Removing:').parentElement).toHaveTextContent('Removing: Alpha Site');
    expect(screen.getByRole('button', { name: 'Update facilities' })).toBeInTheDocument();
  });

  it('omits the Removing line when only adding', async () => {
    renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());

    expect(screen.getByText('Adding:')).toBeInTheDocument();
    expect(screen.queryByText('Removing:')).not.toBeInTheDocument();
  });

  it('moves a single-facility member by unchecking the old facility and checking the new one', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    renderModal();

    await userEvent.click(box(/Alpha Site/));
    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    expect(mockSetStaffFacilities).toHaveBeenCalledTimes(1);
    expect(mockSetStaffFacilities).toHaveBeenCalledWith('ou-1', ['fac-2']);
  });

  it('REGRESSION: adding a third facility to a member of two sends all three ids', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    renderModal({ ...MEMBER, currentFacilities: [ALPHA, BETA] });

    await userEvent.click(box(/Gamma Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    const [, ids] = mockSetStaffFacilities.mock.calls[0] as [string, string[]];
    expect([...ids].sort()).toEqual(['fac-1', 'fac-2', 'fac-3']);
  });

  it('REGRESSION: unchecking one of two facilities sends only the other one', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    renderModal({ ...MEMBER, currentFacilities: [ALPHA, BETA] });

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    expect(mockSetStaffFacilities).toHaveBeenCalledWith('ou-1', ['fac-1']);
  });

  it('keeps a current facility the viewer cannot see: shown checked and disabled, always in the payload', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    const hidden = { id: 'fac-hidden', name: 'Hidden Annex' };
    renderModal({ ...MEMBER, currentFacilities: [ALPHA, hidden] });

    const lockedBox = box(/Hidden Annex/);
    expect(lockedBox).toBeChecked();
    expect(lockedBox).toBeDisabled();
    expect(screen.getByText(/Outside the facilities you manage/)).toBeInTheDocument();

    await userEvent.click(box(/Alpha Site/));
    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    expect(screen.queryByText(/Removing:.*Hidden Annex/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    const [, ids] = mockSetStaffFacilities.mock.calls[0] as [string, string[]];
    expect([...ids].sort()).toEqual(['fac-2', 'fac-hidden']);
  });

  it('closes and refreshes the page on success', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: true });
    const { onClose } = renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows the server error and returns to the select step without closing, on failure', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: false, error: 'Forbidden' });
    const { onClose } = renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(reviewButton()).toBeInTheDocument();
    expect(box(/Beta Site/)).toBeChecked();
  });

  it('falls back to "Failed to update facilities." when the server gives no message', async () => {
    mockSetStaffFacilities.mockResolvedValue({ success: false });
    renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Update facilities' }));

    expect(await screen.findByText('Failed to update facilities.')).toBeInTheDocument();
  });

  it('lets Cancel from the confirm step return to select without submitting', async () => {
    renderModal();

    await userEvent.click(box(/Beta Site/));
    await userEvent.click(reviewButton());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(reviewButton()).toBeInTheDocument();
    expect(mockSetStaffFacilities).not.toHaveBeenCalled();
  });
});
