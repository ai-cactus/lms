/**
 * Tests for the "Create Course Modules" wizard step.
 *
 * The step owns the in-progress module form and reports its state upward:
 * `onModulesChange` carries committed modules into the wizard draft, and
 * `onDraftStatusChange` drives the wizard's Continue gate. PHI is a hard block —
 * a flagged document is never stored server-side, so the slot is cleared too.
 *
 * The per-module deadline is only offered from the second module onward: the
 * first module may turn out to BE the whole course, and a whole course carries
 * no per-module deadline.
 */
import { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUploadDocument, mockGetDocuments } = vi.hoisted(() => ({
  mockUploadDocument: vi.fn(),
  mockGetDocuments: vi.fn(),
}));

vi.mock('@/app/actions/documents', () => ({
  uploadDocument: mockUploadDocument,
  getDocuments: mockGetDocuments,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Step2Modules, { type ModuleDraftStatus, type Step2ModulesHandle } from './Step2Modules';
import { CourseWizardModule } from '@/types/course';

// jsdom stubs Radix Select depends on.
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

const STORED_PDF = {
  id: 'doc-1',
  filename: 'infection-control.pdf',
  size: 2_202_010,
  mimeType: 'application/pdf',
};

function renderStep(
  overrides: Partial<React.ComponentProps<typeof Step2Modules>> = {},
  ref?: React.Ref<Step2ModulesHandle>,
) {
  const onModulesChange = vi.fn();
  const onDraftStatusChange = vi.fn();
  render(
    <Step2Modules
      ref={ref}
      modules={[]}
      onModulesChange={onModulesChange}
      onDraftStatusChange={onDraftStatusChange}
      {...overrides}
    />,
  );
  return { onModulesChange, onDraftStatusChange };
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

async function fillTextFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Module Title/i), 'Infection Prevention & Control');
  await user.type(screen.getByLabelText(/Objective/i), 'Apply safe hygiene practices.');
}

async function pickDeadline(user: ReturnType<typeof userEvent.setup>, label = '2 days') {
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: label }));
}

const COMMITTED_MODULE: CourseWizardModule = {
  title: 'Infection Prevention & Control',
  objective: 'Apply safe hygiene practices.',
  completionDeadlineDays: null,
  documentId: 'doc-existing',
  fileName: 'existing.pdf',
  fileSize: 1_000_000,
  mimeType: 'application/pdf',
};

function lastStatus(onDraftStatusChange: ReturnType<typeof vi.fn>): ModuleDraftStatus {
  return onDraftStatusChange.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadDocuments();
});

function mockUploadDocuments() {
  mockUploadDocument.mockResolvedValue({ success: true, phiDetected: false });
  mockGetDocuments.mockResolvedValue([STORED_PDF]);
}

describe('Step2Modules', () => {
  it('starts empty, with the module form and no committed cards', () => {
    const { onDraftStatusChange } = renderStep();

    expect(screen.getByRole('heading', { name: 'Create Course Modules' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Module Title/i)).toHaveValue('');
    expect(screen.queryByText(/^MODULE 1$/i)).not.toBeInTheDocument();
    expect(lastStatus(onDraftStatusChange)).toBe('empty');
  });

  it('uploads a training document, confirms it is PHI-free and commits it as a module', async () => {
    const user = userEvent.setup();
    const { onModulesChange, onDraftStatusChange } = renderStep();

    await fillTextFields(user);
    await attestAndUpload(user);

    expect(
      await screen.findByText(/No Protected Health Information \(PHI\) detected/i),
    ).toBeVisible();
    expect(screen.getByText(STORED_PDF.filename)).toBeInTheDocument();
    expect(screen.getByText('2.1 MB')).toBeInTheDocument();
    await waitFor(() => expect(lastStatus(onDraftStatusChange)).toBe('complete'));

    await user.click(screen.getByRole('button', { name: /Add module/i }));

    expect(onModulesChange).toHaveBeenCalledWith([
      {
        title: 'Infection Prevention & Control',
        objective: 'Apply safe hygiene practices.',
        completionDeadlineDays: null,
        documentId: STORED_PDF.id,
        fileName: STORED_PDF.filename,
        fileSize: STORED_PDF.size,
        mimeType: STORED_PDF.mimeType,
      } satisfies CourseWizardModule,
    ]);

    // The form resets for the next module.
    expect(screen.getByLabelText(/Module Title/i)).toHaveValue('');
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
    await waitFor(() => expect(lastStatus(onDraftStatusChange)).toBe('empty'));
  });

  it('clears the upload slot and warns when the server detects PHI', async () => {
    const user = userEvent.setup();
    mockUploadDocument.mockResolvedValue({
      error: 'This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be uploaded.',
      phiDetected: true,
    });
    const { onModulesChange, onDraftStatusChange } = renderStep();

    await fillTextFields(user);
    await attestAndUpload(user);

    expect(await screen.findByText('PHI WARNING')).toBeVisible();
    expect(
      screen.getByText(
        /Protected Health Information \(PHI\) detected\. Ensure all uploads comply/i,
      ),
    ).toBeVisible();
    expect(screen.getByText(/This document was not saved/i)).toBeVisible();

    // Nothing is attached, so the module cannot be added.
    expect(screen.queryByText(STORED_PDF.filename)).not.toBeInTheDocument();
    expect(fileInput()).toBeInTheDocument();
    expect(mockGetDocuments).not.toHaveBeenCalled();
    await waitFor(() => expect(lastStatus(onDraftStatusChange)).toBe('partial'));

    await user.click(screen.getByRole('button', { name: /Add module/i }));
    expect(onModulesChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Add a title, objective and training document/i)).toBeVisible();
  });

  it('will not upload until the PHI attestation is given', async () => {
    const user = userEvent.setup();
    renderStep();

    await user.upload(fileInput(), pdf());

    expect(mockUploadDocument).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm the document contains no PHI/i)).toBeVisible();
  });

  it('reports a half-filled form as partial so the wizard can block Continue', async () => {
    const user = userEvent.setup();
    const { onDraftStatusChange } = renderStep();

    await user.type(screen.getByLabelText(/Module Title/i), 'Fire safety');

    await waitFor(() => expect(lastStatus(onDraftStatusChange)).toBe('partial'));
  });

  it('commits a complete form through the imperative handle, for Continue', async () => {
    const user = userEvent.setup();
    const ref = createRef<Step2ModulesHandle>();
    const { onModulesChange } = renderStep({}, ref);

    expect(ref.current?.commitDraft()).toBeNull();

    await fillTextFields(user);
    await attestAndUpload(user);
    await screen.findByText(STORED_PDF.filename);

    expect(ref.current?.commitDraft()).toMatchObject({
      title: 'Infection Prevention & Control',
      completionDeadlineDays: null,
      documentId: STORED_PDF.id,
    });
    expect(onModulesChange).toHaveBeenCalledTimes(1);
  });

  it('renders committed modules as numbered cards that can be deleted', async () => {
    const user = userEvent.setup();
    const modules: CourseWizardModule[] = [
      {
        title: 'Infection Prevention & Control',
        objective: 'Apply safe hygiene practices.',
        completionDeadlineDays: null,
        documentId: 'doc-1',
        fileName: 'infection-control.pdf',
        fileSize: 2_202_010,
        mimeType: 'application/pdf',
      },
      {
        title: 'Workplace Safety Guidelines',
        objective: 'Follow site safety rules.',
        completionDeadlineDays: 5,
        documentId: 'doc-2',
        fileName: 'workplace-safety.docx',
        fileSize: 900_000,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      {
        title: 'Fire Safety',
        objective: 'Evacuate safely.',
        completionDeadlineDays: 7,
        documentId: 'doc-3',
        fileName: 'fire-safety.pdf',
        fileSize: 500_000,
        mimeType: 'application/pdf',
      },
    ];
    const { onModulesChange } = renderStep({ modules });

    expect(screen.getByText('Module 1')).toBeInTheDocument();
    expect(screen.getByText('Module 3')).toBeInTheDocument();
    expect(screen.getByText('Workplace Safety Guidelines')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete module 1' }));

    expect(onModulesChange).toHaveBeenCalledWith([modules[1], modules[2]]);
  });

  it('does not ask the first module for a deadline', () => {
    renderStep();

    expect(screen.queryByText(/Module Completion Deadline/i)).not.toBeInTheDocument();
  });

  it('asks every module after the first for a deadline and commits it', async () => {
    const user = userEvent.setup();
    const { onModulesChange } = renderStep({ modules: [COMMITTED_MODULE] });

    expect(screen.getByText(/Module Completion Deadline/i)).toBeInTheDocument();

    await fillTextFields(user);
    await pickDeadline(user);
    await attestAndUpload(user);
    await screen.findByText(STORED_PDF.filename);
    await user.click(screen.getByRole('button', { name: /Add module/i }));

    expect(onModulesChange).toHaveBeenCalledWith([
      COMMITTED_MODULE,
      expect.objectContaining({ completionDeadlineDays: 2 }),
    ]);
  });

  it('blocks a second module until its deadline is chosen', async () => {
    const user = userEvent.setup();
    const { onModulesChange, onDraftStatusChange } = renderStep({ modules: [COMMITTED_MODULE] });

    await fillTextFields(user);
    await attestAndUpload(user);
    await screen.findByText(STORED_PDF.filename);

    await waitFor(() => expect(lastStatus(onDraftStatusChange)).toBe('partial'));
    await user.click(screen.getByRole('button', { name: /Add module/i }));

    expect(onModulesChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Add a title, objective, deadline and training document/i),
    ).toBeVisible();
  });

  it("clears the survivor's deadline when deleting back down to a whole course", async () => {
    const user = userEvent.setup();
    const modules: CourseWizardModule[] = [
      COMMITTED_MODULE,
      {
        title: 'Workplace Safety Guidelines',
        objective: 'Follow site safety rules.',
        completionDeadlineDays: 5,
        documentId: 'doc-2',
        fileName: 'workplace-safety.docx',
        fileSize: 900_000,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ];
    const { onModulesChange } = renderStep({ modules });

    await user.click(screen.getByRole('button', { name: 'Delete module 1' }));

    expect(onModulesChange).toHaveBeenCalledWith([{ ...modules[1], completionDeadlineDays: null }]);
  });

  it('pre-fills the slot with the deep-linked document', async () => {
    const { onDraftStatusChange } = renderStep({
      initialDocument: {
        documentId: STORED_PDF.id,
        fileName: STORED_PDF.filename,
        fileSize: STORED_PDF.size,
        mimeType: STORED_PDF.mimeType,
      },
    });

    expect(screen.getByText(STORED_PDF.filename)).toBeInTheDocument();
    expect(screen.getByText(/No Protected Health Information \(PHI\) detected/i)).toBeVisible();
    expect(lastStatus(onDraftStatusChange)).toBe('partial');
  });
});
