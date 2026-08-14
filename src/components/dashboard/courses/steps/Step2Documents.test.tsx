/**
 * Step2Documents PHI attestation — course-wizard upload regression.
 *
 * The server action rejects any upload whose FormData lacks
 * `phiAttested === 'true'` (src/app/actions/documents.ts). This step had no
 * attestation control and never sent the field, so EVERY upload started from
 * the course wizard failed with "You must confirm this document contains no
 * PHI" regardless of the file — while the action's own unit tests passed,
 * because they build the FormData themselves. Nothing covered the contract
 * between the two.
 *
 * These tests pin the client half: the attestation must gate the picker, and
 * its value must reach the caller rather than being assumed.
 */
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import Step2Documents from './Step2Documents';

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The uploader sits behind a Radix `Select`, which needs pointer-capture and
// scroll APIs this project's jsdom setup does not provide (see the note in
// InviteStaffModal.test.tsx). Stubbed here rather than globally so no other
// suite's behaviour changes.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

async function renderStep(onUpload = vi.fn()) {
  render(<Step2Documents documents={[]} onToggleSelect={vi.fn()} onUpload={onUpload} />);
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(await screen.findByRole('option', { name: 'Browse Computer' }));
  return onUpload;
}

const pdf = () => new File(['%PDF-1.4'], 'policy.pdf', { type: 'application/pdf' });

describe('Step2Documents PHI attestation', () => {
  it('renders an attestation checkbox, unchecked by default', async () => {
    await renderStep();
    const checkbox = screen.getByLabelText(/no Personal Health Information/i);
    expect(checkbox).toBeTruthy();
    expect(checkbox.getAttribute('data-state')).toBe('unchecked');
  });

  it('does not upload while the attestation is unchecked', async () => {
    const onUpload = await renderStep();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [pdf()] } });

    expect(onUpload).not.toHaveBeenCalled();
  });

  it('forwards phiAttested=true once the box is checked', async () => {
    const onUpload = await renderStep();
    fireEvent.click(screen.getByLabelText(/no Personal Health Information/i));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pdf()] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][1]).toBe(true);
  });
});
