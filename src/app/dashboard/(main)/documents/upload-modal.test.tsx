/**
 * Tests for the two-step upload modal.
 *
 * Step 1 picks a REQUIRED category from the organization's own vocabulary;
 * "Other" swaps in the custom-category input, whose Continue creates the
 * category server-side before the flow advances. Step 2 queues the files and
 * uploads the whole batch under that one category — the single-category
 * contract `uploadDocuments` has always had.
 *
 * The PHI attestation checkbox stays on step 2 even though the mock omits it:
 * `uploadDocuments` rejects any batch without `phiAttested === 'true'`, so
 * dropping it would make every upload fail server-side.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRefresh, mockUploadDocuments, mockCreateDocumentCategory } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockUploadDocuments: vi.fn(),
  mockCreateDocumentCategory: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/app/actions/documents', () => ({ uploadDocuments: mockUploadDocuments }));
vi.mock('@/app/actions/document-categories', () => ({
  createDocumentCategory: mockCreateDocumentCategory,
}));

import UploadModal from './upload-modal';

// jsdom stubs Radix Select/Dialog depend on.
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

const ORG_CATEGORIES = ['Clinical', 'Compliance', 'HR', 'Other'];

function pdf(name: string) {
  return new File(['%PDF-1.4 bytes'], name, { type: 'application/pdf' });
}

function renderModal(onClose = vi.fn()) {
  render(<UploadModal categories={ORG_CATEGORIES} onClose={onClose} />);
  return { onClose };
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('file input not rendered');
  return input as HTMLInputElement;
}

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Category' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadDocuments.mockResolvedValue({ results: [] });
});

describe('UploadModal — step 1: category is required', () => {
  it('opens on the category step, with no dropzone in sight', () => {
    renderModal();

    expect(screen.getByRole('combobox', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("offers the organization's categories, with Other pinned once as the add-new entry", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('combobox', { name: 'Category' }));
    const options = await screen.findAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Clinical',
      'Compliance',
      'HR',
      'Other',
    ]);
  });

  it('refuses to advance with no category chosen', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Select a category to continue.')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('advances straight to the file step once an existing category is chosen', async () => {
    const user = userEvent.setup();
    renderModal();

    await chooseCategory(user, 'Compliance');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Drop files here or/)).toBeInTheDocument();
    expect(screen.getByText('PDF or DOCX · up to 10 MB each')).toBeInTheDocument();
    expect(mockCreateDocumentCategory).not.toHaveBeenCalled();
  });

  it('closes without uploading when Cancel is pressed', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockUploadDocuments).not.toHaveBeenCalled();
  });
});

describe('UploadModal — step 1: Other creates a new category', () => {
  it('swaps the select for the named-category input with the hub-filter helper copy', async () => {
    const user = userEvent.setup();
    renderModal();

    await chooseCategory(user, 'Other');

    expect(screen.getByRole('textbox', { name: 'Category' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'The new categories will appear in the hub filter for every facility immediately.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Category' })).not.toBeInTheDocument();
  });

  it('creates the category on Continue, then advances to the file step', async () => {
    mockCreateDocumentCategory.mockResolvedValueOnce({ name: 'Clinical Operations' });
    const user = userEvent.setup();
    renderModal();

    await chooseCategory(user, 'Other');
    await user.type(screen.getByRole('textbox', { name: 'Category' }), 'Clinical Operations');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(mockCreateDocumentCategory).toHaveBeenCalledExactlyOnceWith('Clinical Operations'),
    );
    expect(await screen.findByText(/Drop files here or/)).toBeInTheDocument();
    // The hub filter reads categories server-side, so it has to be told.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('stays on the category step and surfaces the server error when creation fails', async () => {
    mockCreateDocumentCategory.mockResolvedValueOnce({
      error: 'You do not have permission to add categories.',
    });
    const user = userEvent.setup();
    renderModal();

    await chooseCategory(user, 'Other');
    await user.type(screen.getByRole('textbox', { name: 'Category' }), 'Clinical Operations');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(
      await screen.findByText('You do not have permission to add categories.'),
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('refuses to create a blank category', async () => {
    const user = userEvent.setup();
    renderModal();

    await chooseCategory(user, 'Other');
    await user.type(screen.getByRole('textbox', { name: 'Category' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Category name is required.')).toBeInTheDocument();
    expect(mockCreateDocumentCategory).not.toHaveBeenCalled();
  });
});

describe('UploadModal — step 2: files', () => {
  async function reachFileStep(user: ReturnType<typeof userEvent.setup>) {
    await chooseCategory(user, 'Compliance');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Drop files here or/);
  }

  it('starts at "Upload 0 files", disabled', async () => {
    const user = userEvent.setup();
    renderModal();
    await reachFileStep(user);

    expect(screen.getByRole('button', { name: 'Upload 0 files' })).toBeDisabled();
  });

  it('counts queued files in the button label and drops them again on remove', async () => {
    const user = userEvent.setup();
    renderModal();
    await reachFileStep(user);

    await user.upload(fileInput(), [pdf('one.pdf'), pdf('two.pdf')]);

    expect(screen.getByText('one.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 2 files' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove one.pdf' }));

    expect(screen.queryByText('one.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeInTheDocument();
  });

  it('rejects a non-PDF/DOCX file and never queues it', async () => {
    // `applyAccept: false` so the file reaches the component: the dropzone's
    // `accept` attribute is a hint, and drag-and-drop ignores it — the modal's
    // own validation is the guard under test.
    const user = userEvent.setup({ applyAccept: false });
    renderModal();
    await reachFileStep(user);

    await user.upload(fileInput(), new File(['x'], 'legacy.doc', { type: 'application/msword' }));

    expect(
      screen.getByText('Skipped 1 file(s): legacy.doc (only PDF and DOCX are allowed)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 0 files' })).toBeDisabled();
  });

  it('stays disabled until the PHI attestation is ticked', async () => {
    const user = userEvent.setup();
    renderModal();
    await reachFileStep(user);

    await user.upload(fileInput(), pdf('one.pdf'));
    expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeDisabled();

    await user.click(screen.getByLabelText(/no Personal Health Information/i));
    expect(screen.getByRole('button', { name: 'Upload 1 file' })).toBeEnabled();
  });

  it('submits every file under the single chosen category, with the attestation', async () => {
    mockUploadDocuments.mockResolvedValueOnce({ results: [{ name: 'one.pdf', ok: true }] });
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await reachFileStep(user);

    await user.upload(fileInput(), [pdf('one.pdf'), pdf('two.pdf')]);
    await user.click(screen.getByLabelText(/no Personal Health Information/i));
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    await waitFor(() => expect(mockUploadDocuments).toHaveBeenCalledTimes(1));
    const formData = mockUploadDocuments.mock.calls[0][0] as FormData;
    expect(formData.get('category')).toBe('Compliance');
    expect(formData.get('phiAttested')).toBe('true');
    expect(formData.getAll('files')).toHaveLength(2);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('keeps a failed file queued for retry and reports why', async () => {
    mockUploadDocuments.mockResolvedValueOnce({
      results: [
        { name: 'one.pdf', ok: true },
        { name: 'two.pdf', ok: false, error: 'Upload blocked — PHI detected' },
      ],
    });
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await reachFileStep(user);

    await user.upload(fileInput(), [pdf('one.pdf'), pdf('two.pdf')]);
    await user.click(screen.getByLabelText(/no Personal Health Information/i));
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    expect(await screen.findByText('Upload blocked — PHI detected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry 1 file' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
