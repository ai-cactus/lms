/**
 * Unit tests for src/components/dashboard/training/AssignRetakeModal.tsx.
 *
 * fix/server-action-error-messages: assignRetake now RETURNS its refusal
 * (`{ success: false, refusedReason }`) rather than throwing, so the reason
 * survives Next.js's production redaction of Server Action errors. The modal
 * must surface `result.refusedReason` verbatim — a refusal that returns
 * cleanly but renders the generic fallback (or nothing) is no better than the
 * redaction it replaced.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockAssignRetake, mockRouterRefresh } = vi.hoisted(() => ({
  mockAssignRetake: vi.fn(),
  mockRouterRefresh: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({ assignRetake: mockAssignRetake }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import AssignRetakeModal from './AssignRetakeModal';

const ENROLLMENT_ID = 'enrollment-1';

function renderModal(overrides: Partial<React.ComponentProps<typeof AssignRetakeModal>> = {}) {
  const onClose = vi.fn();
  render(
    <AssignRetakeModal
      isOpen
      onClose={onClose}
      enrollmentId={ENROLLMENT_ID}
      courseName="Infection Control"
      userName="Jane Worker"
      {...overrides}
    />,
  );
  return { onClose };
}

const assignButton = () => screen.getByRole('button', { name: 'Assign Retake' });

/** Local noon, so "14 days from today" is the same calendar date in every zone. */
const TODAY = new Date(2026, 8, 28, 12, 0, 0);
const DEFAULT_DUE_DATE = '2026-10-12';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AssignRetakeModal — due date (Q-26)', () => {
  it('pre-fills the due date 14 days out', () => {
    renderModal();

    expect(screen.getByRole('button', { name: 'Retake due date' })).toHaveTextContent(
      'October 12, 2026',
    );
  });

  it('submits the pre-filled due date with the retake', async () => {
    mockAssignRetake.mockResolvedValue({ success: true });
    renderModal();

    fireEvent.click(assignButton());

    await waitFor(() =>
      expect(mockAssignRetake).toHaveBeenCalledWith(ENROLLMENT_ID, '', DEFAULT_DUE_DATE),
    );
  });

  it("shows the server's refusal of the date verbatim", async () => {
    mockAssignRetake.mockResolvedValue({
      success: false,
      refusedReason: 'The retake due date must be today or later.',
    });
    renderModal();

    fireEvent.click(assignButton());

    expect(
      await screen.findByText('The retake due date must be today or later.'),
    ).toBeInTheDocument();
  });
});

describe('AssignRetakeModal — success', () => {
  it('refreshes the page and closes on success', async () => {
    mockAssignRetake.mockResolvedValue({ success: true, retakeEnrollmentId: 'retake-1' });
    const { onClose } = renderModal();

    fireEvent.click(assignButton());

    await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(mockAssignRetake).toHaveBeenCalledWith(ENROLLMENT_ID, '', DEFAULT_DUE_DATE);
  });

  it('submits the typed reason', async () => {
    mockAssignRetake.mockResolvedValue({ success: true });
    renderModal();

    fireEvent.change(screen.getByLabelText('Reason for retake (optional)'), {
      target: { value: 'Granted a second chance' },
    });
    fireEvent.click(assignButton());

    await waitFor(() =>
      expect(mockAssignRetake).toHaveBeenCalledWith(
        ENROLLMENT_ID,
        'Granted a second chance',
        DEFAULT_DUE_DATE,
      ),
    );
  });
});

describe('AssignRetakeModal — refusal is returned, not thrown', () => {
  it('renders the returned refusedReason verbatim and keeps the modal open', async () => {
    mockAssignRetake.mockResolvedValue({
      success: false,
      refusedReason:
        "This learner hasn't failed the assessment yet — retakes are only available once all attempts are used.",
    });
    const { onClose } = renderModal();

    fireEvent.click(assignButton());

    expect(
      await screen.findByText(
        "This learner hasn't failed the assessment yet — retakes are only available once all attempts are used.",
      ),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });

  it('renders the other refusal reason verbatim (active retake already exists)', async () => {
    mockAssignRetake.mockResolvedValue({
      success: false,
      refusedReason: 'This learner already has a retake in progress for this course.',
    });
    renderModal();

    fireEvent.click(assignButton());

    expect(
      await screen.findByText('This learner already has a retake in progress for this course.'),
    ).toBeInTheDocument();
  });

  it('falls back to the generic message when the refusal carries no reason', async () => {
    mockAssignRetake.mockResolvedValue({ success: false });
    const { onClose } = renderModal();

    fireEvent.click(assignButton());

    expect(
      await screen.findByText('Failed to assign retake. Please try again.'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AssignRetakeModal — unexpected thrown error (hard failure, not a refusal)', () => {
  it('shows the thrown error message and keeps the modal open', async () => {
    mockAssignRetake.mockRejectedValue(new Error('Unauthorized'));
    const { onClose } = renderModal();

    fireEvent.click(assignButton());

    expect(await screen.findByText('Unauthorized')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a generic message when the thrown value is not an Error', async () => {
    mockAssignRetake.mockRejectedValue('not an Error instance');
    renderModal();

    fireEvent.click(assignButton());

    expect(
      await screen.findByText('An error occurred while assigning the retake.'),
    ).toBeInTheDocument();
  });
});
