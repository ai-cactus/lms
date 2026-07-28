/**
 * Regression tests for `DocumentListClient`'s registry-driven prop gating
 * (fix 867cda0): Rename/Delete row actions and the empty-state copy now
 * depend on the `canUpload`/`canEdit`/`canDelete` props threaded down from
 * the page's `document.create`/`document.edit`/`document.delete` checks,
 * instead of being shown to every viewer unconditionally.
 *
 * `RowActionsMenu` is a generic, already-styled Radix dropdown untested
 * elsewhere in this repo; rather than fight its portal/open-state internals,
 * it's stubbed here to render its `actions` prop as plain buttons so the
 * assertions target this component's own gating logic, not Radix.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RowAction } from '@/components/ui';

const { mockPush, mockDeleteDocument, mockRenameDocument } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockRenameDocument: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('@/app/actions/documents', () => ({
  deleteDocument: mockDeleteDocument,
  renameDocument: mockRenameDocument,
}));
vi.mock('@/components/ui', () => ({
  RowActionsMenu: ({ actions }: { actions: RowAction[] }) => (
    <div data-testid="row-actions">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={action.disabled}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  ),
}));

import DocumentListClient from './DocumentListClient';

const baseDoc = {
  id: 'doc-1',
  filename: 'consent-form.pdf',
  mimeType: 'application/pdf',
  size: 12_345,
  updatedAt: new Date('2026-01-01'),
  user: { email: 'uploader@example.com', profile: { firstName: 'Ada', lastName: 'Lovelace' } },
  versions: [{ version: 1, courseVersions: [], phiReport: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DocumentListClient — row action gating', () => {
  it('always shows View, regardless of edit/delete grants', () => {
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={false}
        canEdit={false}
        canDelete={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('shows Rename only when canEdit is true', () => {
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={false}
        canEdit={true}
        canDelete={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('shows Delete only when canDelete is true', () => {
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={false}
        canEdit={false}
        canDelete={true}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows both Rename and Delete for a full-access role', () => {
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={true}
        canEdit={true}
        canDelete={true}
      />,
    );

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('disables Delete when the document has an associated course, even with canDelete', () => {
    const docWithCourse = {
      ...baseDoc,
      versions: [
        {
          version: 1,
          courseVersions: [
            { courseId: 'course-1', course: { title: 'HIPAA', status: 'published' } },
          ],
          phiReport: null,
        },
      ],
    };

    render(
      <DocumentListClient
        initialDocs={[docWithCourse]}
        canUpload={true}
        canEdit={true}
        canDelete={true}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('DocumentListClient — empty-state copy', () => {
  it('invites upload when canUpload is true and there are no documents', () => {
    render(
      <DocumentListClient initialDocs={[]} canUpload={true} canEdit={false} canDelete={false} />,
    );

    expect(screen.getByText('Upload a document to get started.')).toBeInTheDocument();
    expect(screen.queryByText('No documents have been uploaded yet.')).not.toBeInTheDocument();
  });

  it('shows neutral copy when canUpload is false and there are no documents', () => {
    render(
      <DocumentListClient initialDocs={[]} canUpload={false} canEdit={false} canDelete={false} />,
    );

    expect(screen.getByText('No documents have been uploaded yet.')).toBeInTheDocument();
    expect(screen.queryByText('Upload a document to get started.')).not.toBeInTheDocument();
  });

  it('shows the search-specific empty copy regardless of canUpload once a query narrows to zero results', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={true}
        canEdit={true}
        canDelete={true}
      />,
    );

    await user.type(screen.getByLabelText('Search documents'), 'no-such-file');

    expect(screen.getByText('No documents match your search.')).toBeInTheDocument();
    expect(screen.queryByText('Upload a document to get started.')).not.toBeInTheDocument();
  });
});

describe('DocumentListClient — row interactions still work through the gated actions', () => {
  it('navigates to the document viewer on View', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={true}
        canEdit={true}
        canDelete={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(mockPush).toHaveBeenCalledExactlyOnceWith('/dashboard/documents/doc-1');
  });

  it('opens the rename modal and submits the new name via renameDocument', async () => {
    mockRenameDocument.mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[baseDoc]}
        canUpload={true}
        canEdit={true}
        canDelete={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New document name');
    await user.clear(input);
    await user.type(input, 'renamed.pdf');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockRenameDocument).toHaveBeenCalledExactlyOnceWith('doc-1', 'renamed.pdf');
  });
});
