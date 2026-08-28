/**
 * Unit tests for src/components/dashboard/training/AttestationModal.tsx.
 *
 * fix/server-action-error-messages: issueCertificate now returns a
 * discriminated result (`{ ok: true; certificate } | { ok: false; reason }`)
 * instead of throwing, so the reason survives Next.js's production redaction
 * of Server Action errors. The modal must unwrap `result.certificate` ONLY on
 * `ok: true`, and must show `result.reason` verbatim on `ok: false` without
 * calling onSuccess.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAttestCourse, mockIssueCertificate } = vi.hoisted(() => ({
  mockAttestCourse: vi.fn(),
  mockIssueCertificate: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({ attestCourse: mockAttestCourse }));
vi.mock('@/app/actions/certificate', () => ({ issueCertificate: mockIssueCertificate }));

import AttestationModal from './AttestationModal';

const ENROLLMENT_ID = 'enrollment-1';

function renderModal(overrides: Partial<React.ComponentProps<typeof AttestationModal>> = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(
    <AttestationModal
      isOpen
      onClose={onClose}
      enrollmentId={ENROLLMENT_ID}
      courseName="Infection Control"
      userEmail="jane@acme.com"
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onClose, onSuccess };
}

async function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jane Worker' } });
  fireEvent.click(screen.getByLabelText(/I hereby certify/));
  fireEvent.click(screen.getByLabelText(/I confirm that I have read/));
}

const confirmButton = () => screen.getByRole('button', { name: 'Confirm' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAttestCourse.mockResolvedValue(undefined);
});

describe('AttestationModal — issueCertificate ok:true', () => {
  it('calls onSuccess with the certificate id and never shows an error', async () => {
    mockIssueCertificate.mockResolvedValue({ ok: true, certificate: { id: 'cert-123' } });
    const { onSuccess } = renderModal();

    await fillValidForm();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('cert-123'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AttestationModal — issueCertificate ok:false (returned refusal)', () => {
  it('renders the returned reason verbatim and does NOT call onSuccess', async () => {
    mockIssueCertificate.mockResolvedValue({
      ok: false,
      reason: 'Set your full name in your profile before earning a certificate.',
    });
    const { onSuccess } = renderModal();

    await fillValidForm();
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText('Set your full name in your profile before earning a certificate.'),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('renders the other refusal reason verbatim (course not completed)', async () => {
    mockIssueCertificate.mockResolvedValue({
      ok: false,
      reason: 'Course must be completed to issue a certificate',
    });
    const { onSuccess } = renderModal();

    await fillValidForm();
    fireEvent.click(confirmButton());

    expect(
      await screen.findByText('Course must be completed to issue a certificate'),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('AttestationModal — attestCourse throws (hard failure, unrelated to the certificate result)', () => {
  it('shows the thrown message and never calls issueCertificate', async () => {
    mockAttestCourse.mockRejectedValue(new Error('Unauthorized'));
    const { onSuccess } = renderModal();

    await fillValidForm();
    fireEvent.click(confirmButton());

    expect(await screen.findByText('Unauthorized')).toBeInTheDocument();
    expect(mockIssueCertificate).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
