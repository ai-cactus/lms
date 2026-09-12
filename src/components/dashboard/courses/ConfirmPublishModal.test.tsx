/**
 * Unit tests for src/components/dashboard/courses/ConfirmPublishModal.tsx
 *
 * D8 (publish reviewer attribution): the reviewer persisted against a course
 * is now resolved server-side from the session (see publishCourse/
 * createFullCourse in course.ts) — the modal's "Reviewed by" field is
 * display-only. `onConfirm` was narrowed from `(reviewerName: string) => void`
 * to `() => void` accordingly: the client sends no reviewer at all, so there
 * is nothing for a caller to smuggle a different name through. These tests
 * pin that contract and the attestation-gated Publish button.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUseSession, mockGetCourses } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockGetCourses: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ useSession: mockUseSession }));
vi.mock('@/app/actions/course', () => ({ getCourses: mockGetCourses }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// next/image doesn't work in jsdom — stub with a plain <img>
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string; [key: string]: unknown }) => <img alt={alt} />,
}));

import ConfirmPublishModal from './ConfirmPublishModal';

function renderModal(overrides: Partial<React.ComponentProps<typeof ConfirmPublishModal>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmPublishModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      courseTitle="HIPAA Privacy Training"
      isPublishing={false}
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

const publishButton = () => screen.getByRole('button', { name: 'Publish' });
const attestationCheckbox = () => screen.getByRole('checkbox', { name: /reviewed and approved/i });
const reviewerInput = () => screen.getByLabelText('Reviewer name');

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSession.mockReturnValue({ data: { user: { name: 'Priya Reviewer' } } });
  mockGetCourses.mockResolvedValue([]);
});

describe('ConfirmPublishModal — attestation gate', () => {
  it('keeps Publish disabled until the attestation checkbox is ticked', () => {
    renderModal();

    expect(publishButton()).toBeDisabled();
  });

  it('enables Publish once the attestation checkbox is ticked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(attestationCheckbox());

    expect(publishButton()).toBeEnabled();
  });

  it('disables Publish again if the attestation checkbox is unticked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(attestationCheckbox());
    expect(publishButton()).toBeEnabled();

    await user.click(attestationCheckbox());
    expect(publishButton()).toBeDisabled();
  });
});

describe('ConfirmPublishModal — onConfirm contract (D8)', () => {
  it('calls onConfirm without a reviewer-name string when Publish is clicked', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderModal();

    await user.click(attestationCheckbox());
    await user.click(publishButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // `onClick={onConfirm}` wires the button's native click handler directly,
    // so the DOM click SyntheticEvent is still passed through — that's an
    // unrelated React/DOM mechanic. What D8 actually changed is that the
    // modal no longer sends a reviewer name; assert no string argument ever
    // reaches onConfirm (the old contract always passed one).
    const receivedArgs = onConfirm.mock.calls[0];
    expect(receivedArgs.every((arg) => typeof arg !== 'string')).toBe(true);
  });

  it('calls onClose, not onConfirm, when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmPublishModal — reviewer field is display-only', () => {
  it('pre-fills the reviewer field with the session name and marks it read-only', () => {
    renderModal();

    const input = reviewerInput();
    expect(input).toHaveValue('Priya Reviewer');
    expect(input).toHaveAttribute('readonly');
  });

  it('falls back to "Admin" when the session has no user name', () => {
    mockUseSession.mockReturnValue({ data: { user: {} } });
    renderModal();

    expect(reviewerInput()).toHaveValue('Admin');
  });

  it('ignores keystrokes — the field cannot be edited by the caller', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(reviewerInput(), 'Someone Else');

    expect(reviewerInput()).toHaveValue('Priya Reviewer');
  });
});
