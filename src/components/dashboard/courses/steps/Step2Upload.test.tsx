/**
 * Tests for the "Upload Training Documents" wizard step (D1: one document, one
 * module per course). Step2Upload replaces the multi-module builder
 * (Step2Modules) — it owns no draft of its own; the attachment IS the state,
 * reported upward via `onDocumentChange`.
 *
 * PHI is a hard block (D2): a flagged document is never stored server-side, so
 * the slot is cleared too and `onDocumentChange(null)` fires — this is the
 * single most important test in this file.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUploadDocument } = vi.hoisted(() => ({
  mockUploadDocument: vi.fn(),
}));

vi.mock('@/app/actions/documents', () => ({
  uploadDocument: mockUploadDocument,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Step2Upload from './Step2Upload';
import { CourseWizardModuleDocument } from '@/types/course';

const STORED_PDF = {
  id: 'doc-1',
  filename: 'infection-control.pdf',
  size: 2_202_010,
  mimeType: 'application/pdf',
};

function renderStep(overrides: Partial<React.ComponentProps<typeof Step2Upload>> = {}) {
  const onDocumentChange = vi.fn();
  const onUploadingChange = vi.fn();
  const view = render(
    <Step2Upload
      document={null}
      onDocumentChange={onDocumentChange}
      onUploadingChange={onUploadingChange}
      {...overrides}
    />,
  );
  return { onDocumentChange, onUploadingChange, ...view };
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not rendered');
  return input as HTMLInputElement;
}

function pdf(name = STORED_PDF.filename) {
  return new File(['%PDF-1.4 bytes'], name, { type: 'application/pdf' });
}

async function attestAndUpload(user: ReturnType<typeof userEvent.setup>, file = pdf()) {
  await user.click(screen.getByLabelText(/contains no Personal Health Information/i));
  await user.upload(fileInput(), file);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadDocument.mockResolvedValue({
    success: true,
    phiDetected: false,
    document: STORED_PDF,
  });
});

describe('Step2Upload', () => {
  it('will not upload until the PHI attestation is given', async () => {
    const user = userEvent.setup();
    const { onDocumentChange } = renderStep();

    await user.upload(fileInput(), pdf());

    expect(mockUploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm the document contains no PHI/i)).toBeVisible();
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it('uploads a clean document and reports it upward', async () => {
    const user = userEvent.setup();
    const { onDocumentChange, rerender } = renderStep();

    await attestAndUpload(user);

    expect(
      await screen.findByText(/No Protected Health Information \(PHI\) detected/i),
    ).toBeVisible();
    const expectedDocument: CourseWizardModuleDocument = {
      documentId: STORED_PDF.id,
      fileName: STORED_PDF.filename,
      fileSize: STORED_PDF.size,
      mimeType: STORED_PDF.mimeType,
    };
    expect(onDocumentChange).toHaveBeenCalledWith(expectedDocument);

    // The step is controlled: the caller feeds the emitted document back in as
    // `document`, which is what actually renders the attachment card.
    rerender(
      <Step2Upload
        document={expectedDocument}
        onDocumentChange={onDocumentChange}
        onUploadingChange={vi.fn()}
      />,
    );
    expect(screen.getByText(STORED_PDF.filename)).toBeInTheDocument();
    expect(screen.getByText('2.1 MB')).toBeInTheDocument();
  });

  it('D2 hard block: clears the slot and warns when the server detects PHI', async () => {
    const user = userEvent.setup();
    mockUploadDocument.mockResolvedValue({
      error: 'This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be uploaded.',
      phiDetected: true,
    });
    const { onDocumentChange } = renderStep();

    await attestAndUpload(user);

    expect(await screen.findByText('PHI WARNING')).toBeVisible();
    expect(
      screen.getByText(
        /Protected Health Information \(PHI\) detected\. Ensure all uploads comply/i,
      ),
    ).toBeVisible();
    expect(screen.getByText(/This document was not saved/i)).toBeVisible();

    // The slot is cleared, never left holding the flagged file.
    expect(onDocumentChange).toHaveBeenCalledWith(null);
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
  });

  it('regression guard (7b42fc1): fails loudly when the upload reports success without a document', async () => {
    // Documents are org-wide: resolving the upload by filename could attach a
    // colleague's identically-named file and generate the course from it.
    const user = userEvent.setup();
    mockUploadDocument.mockResolvedValue({ success: true, phiDetected: false });
    const { onDocumentChange } = renderStep();

    await attestAndUpload(user);

    expect(await screen.findByText(/could not be attached/i)).toBeVisible();
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it('removes the attachment and resets to the idle upload state', async () => {
    const user = userEvent.setup();
    const { onDocumentChange, rerender } = renderStep({
      document: {
        documentId: STORED_PDF.id,
        fileName: STORED_PDF.filename,
        fileSize: STORED_PDF.size,
        mimeType: STORED_PDF.mimeType,
      },
    });

    await user.click(screen.getByRole('button', { name: `Remove ${STORED_PDF.filename}` }));

    expect(onDocumentChange).toHaveBeenCalledWith(null);

    // The caller feeds the cleared slot back in as `document`.
    rerender(
      <Step2Upload
        document={null}
        onDocumentChange={onDocumentChange}
        onUploadingChange={vi.fn()}
      />,
    );

    // Back to idle: the dropzone (and its attestation checkbox) is offered again.
    expect(screen.getByLabelText(/contains no Personal Health Information/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/No Protected Health Information \(PHI\) detected/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
  });

  it('pre-fills the slot with the deep-linked document exactly once', async () => {
    const initialDocument: CourseWizardModuleDocument = {
      documentId: STORED_PDF.id,
      fileName: STORED_PDF.filename,
      fileSize: STORED_PDF.size,
      mimeType: STORED_PDF.mimeType,
    };
    const { onDocumentChange, rerender } = renderStep({ initialDocument });

    await waitFor(() => expect(onDocumentChange).toHaveBeenCalledWith(initialDocument));
    expect(onDocumentChange).toHaveBeenCalledTimes(1);

    // Removing the file must not re-attach it — the ref guard fires only once.
    onDocumentChange.mockClear();
    rerender(
      <Step2Upload
        document={null}
        onDocumentChange={onDocumentChange}
        initialDocument={initialDocument}
      />,
    );

    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
  });

  it('reports uploading true then false around an upload', async () => {
    const user = userEvent.setup();
    let resolveUpload!: (value: {
      success: boolean;
      phiDetected: boolean;
      document: typeof STORED_PDF;
    }) => void;
    mockUploadDocument.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    );
    const { onUploadingChange } = renderStep();

    await user.click(screen.getByLabelText(/contains no Personal Health Information/i));
    await user.upload(fileInput(), pdf());

    await waitFor(() => expect(onUploadingChange).toHaveBeenCalledWith(true));

    resolveUpload({ success: true, phiDetected: false, document: STORED_PDF });

    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
    expect(onUploadingChange.mock.calls.map((call) => call[0])).toEqual([false, true, false]);
  });
});
