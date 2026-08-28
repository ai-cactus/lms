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
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AssignRetakeModal — success', () => {
  it('refreshes the page and closes on success', async () => {
    mockAssignRetake.mockResolvedValue({ success: true, retakeEnrollmentId: 'retake-1' });
    const { onClose } = renderModal();

    fireEvent.click(assignButton());

    await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(mockAssignRetake).toHaveBeenCalledWith(ENROLLMENT_ID, '');
  });

  it('submits the typed reason', async () => {
    mockAssignRetake.mockResolvedValue({ success: true });
    renderModal();

    fireEvent.change(screen.getByLabelText('Reason for retake (optional)'), {
      target: { value: 'Granted a second chance' },
    });
    fireEvent.click(assignButton());

    await waitFor(() =>
      expect(mockAssignRetake).toHaveBeenCalledWith(ENROLLMENT_ID, 'Granted a second chance'),
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
