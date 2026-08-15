/**
 * Regression tests for `DocumentListClient`'s registry-driven prop gating
 * (fix 867cda0): the Delete row action and the empty-state copy depend on the
 * `canUpload`/`canDelete` props threaded down from the page's
 * `document.create`/`document.delete` checks, instead of being shown to every
 * viewer unconditionally. Download is offered to every viewer — the page gate
 * plus the preview route's own check already bound who gets here.
 *
 * `RowActionsMenu` is a generic, already-styled Radix dropdown untested
 * elsewhere in this repo; rather than fight its portal/open-state internals,
 * it's stubbed here to render its `actions` prop as plain buttons so the
 * assertions target this component's own gating logic, not Radix.
 */
import { useEffect, type ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RowAction } from '@/components/ui';

const { mockPush, mockDeleteDocument } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockDeleteDocument: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('@/app/actions/documents', () => ({
  deleteDocument: mockDeleteDocument,
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
import { UploadProgressProvider, useUploadProgress } from './upload-progress-context';

// jsdom stubs Radix Select depends on (the category filter + "Show N entries").
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

type Doc = ComponentProps<typeof DocumentListClient>['initialDocs'][number];

const baseDoc: Doc = {
  id: 'doc-1',
  filename: 'consent-form.pdf',
  mimeType: 'application/pdf',
  size: 12_345,
  updatedAt: new Date('2026-01-01'),
  user: { email: 'uploader@example.com', profile: { firstName: 'Ada', lastName: 'Lovelace' } },
  versions: [{ id: 'ver-1', version: 1, courseVersions: [], phiReport: null }],
};

function makeDoc(overrides: Partial<Doc> & { id: string }): Doc {
  return { ...baseDoc, ...overrides };
}

/** A document that already backs a generated course, so it can never be deleted. */
function makeDocWithCourse(overrides: Partial<Doc> & { id: string }): Doc {
  return makeDoc({
    ...overrides,
    versions: [
      {
        id: 'ver-1',
        version: 1,
        courseVersions: [{ courseId: 'course-1', course: { title: 'HIPAA', status: 'published' } }],
        phiReport: null,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DocumentListClient — row action gating', () => {
  it('offers Download alone when the viewer lacks delete', () => {
    render(<DocumentListClient initialDocs={[baseDoc]} canUpload={false} canDelete={false} />);

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('offers exactly Download and Delete for a full-access role', () => {
    render(<DocumentListClient initialDocs={[baseDoc]} canUpload={true} canDelete={true} />);

    const menu = screen.getByTestId('row-actions');
    expect(
      within(menu)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Download', 'Delete']);
  });

  it('carries no Rename action — renaming was dropped from the Document Hub', () => {
    render(<DocumentListClient initialDocs={[baseDoc]} canUpload={true} canDelete={true} />);

    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('keeps Delete enabled for a course-backed document and warns about the severed source link', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const docWithCourse = makeDocWithCourse({ id: 'doc-1' });

    render(<DocumentListClient initialDocs={[docWithCourse]} canUpload={true} canDelete={true} />);

    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      within(screen.getByRole('alertdialog')).getByText(/source-document link will be removed/),
    ).toBeInTheDocument();
  });
});

describe('DocumentListClient — download', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pulls the latest version through the same-origin preview proxy under the real filename', async () => {
    let clicked: { href: string | null; download: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = { href: this.getAttribute('href'), download: this.download };
    });

    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[makeDoc({ id: 'doc-1', filename: 'consent-form.pdf' })]}
        canUpload={false}
        canDelete={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(clicked).toEqual({
      href: '/api/documents/ver-1/preview',
      download: 'consent-form.pdf',
    });
  });
});

describe('DocumentListClient — empty-state copy', () => {
  it('invites upload when canUpload is true and there are no documents', () => {
    render(<DocumentListClient initialDocs={[]} canUpload={true} canDelete={false} />);

    expect(screen.getByText('Upload a document to get started.')).toBeInTheDocument();
    expect(screen.queryByText('No documents have been uploaded yet.')).not.toBeInTheDocument();
  });

  it('shows neutral copy when canUpload is false and there are no documents', () => {
    render(<DocumentListClient initialDocs={[]} canUpload={false} canDelete={false} />);

    expect(screen.getByText('No documents have been uploaded yet.')).toBeInTheDocument();
    expect(screen.queryByText('Upload a document to get started.')).not.toBeInTheDocument();
  });

  it('shows the search-specific empty copy regardless of canUpload once a query narrows to zero results', async () => {
    const user = userEvent.setup();
    render(<DocumentListClient initialDocs={[baseDoc]} canUpload={true} canDelete={true} />);

    await user.type(screen.getByLabelText('Search documents'), 'no-such-file');

    expect(screen.getByText('No documents match your search.')).toBeInTheDocument();
    expect(screen.queryByText('Upload a document to get started.')).not.toBeInTheDocument();
  });
});

describe('DocumentListClient — row interactions still work through the gated actions', () => {
  it('navigates to the document viewer when the row is clicked', async () => {
    const user = userEvent.setup();
    render(<DocumentListClient initialDocs={[baseDoc]} canUpload={true} canDelete={true} />);

    const table = screen.getByRole('table');
    const [dataRow] = within(table).getAllByRole('row').slice(1);
    await user.click(dataRow);

    expect(mockPush).toHaveBeenCalledExactlyOnceWith('/dashboard/documents/doc-1');
  });
});

describe('DocumentListClient — category filter dropdown', () => {
  const categorisedDocs = [
    makeDoc({ id: 'doc-1', filename: 'hr-handbook.pdf', category: 'HR' }),
    makeDoc({ id: 'doc-2', filename: 'incident-policy.pdf', category: 'Compliance' }),
    makeDoc({ id: 'doc-3', filename: 'legacy.pdf', category: null }),
  ];

  // The vocabulary now comes from the organization's own DocumentCategory rows,
  // threaded down by the server page — not a static module-level constant.
  const orgCategories = ['Clinical', 'Compliance', 'HR', 'Operations', 'Other', 'Training'];

  function categoryFilter() {
    return screen.getByRole('combobox', { name: 'Filter by category' });
  }

  /** Picks an option from the category filter by its label. */
  async function chooseCategory(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(categoryFilter());
    await user.click(await screen.findByRole('option', { name: label }));
  }

  it('offers All Documents plus an option only for categories that classify a document', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={categorisedDocs}
        canUpload={false}
        canDelete={false}
        categories={orgCategories}
      />,
    );

    await user.click(categoryFilter());
    const options = await screen.findAllByRole('option');

    // No document is classified Clinical/Operations/Training, so no dead filter.
    // Order follows the organization's own list (alphabetical, as the server
    // sorts it), not a hardcoded declaration order.
    expect(options.map((option) => option.textContent)).toEqual([
      'All Documents',
      'Compliance',
      'HR',
    ]);
  });

  it('starts on All Documents until another category is picked', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={categorisedDocs}
        canUpload={false}
        canDelete={false}
        categories={orgCategories}
      />,
    );

    expect(categoryFilter()).toHaveTextContent('All Documents');

    await chooseCategory(user, 'HR');

    expect(categoryFilter()).toHaveTextContent('HR');
  });

  it('filters the table down to the picked category and back again via All Documents', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={categorisedDocs}
        canUpload={false}
        canDelete={false}
        categories={orgCategories}
      />,
    );

    await chooseCategory(user, 'HR');

    expect(screen.getByText('hr-handbook.pdf')).toBeInTheDocument();
    expect(screen.queryByText('incident-policy.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy.pdf')).not.toBeInTheDocument();

    await chooseCategory(user, 'All Documents');

    expect(screen.getByText('incident-policy.pdf')).toBeInTheDocument();
    expect(screen.getByText('legacy.pdf')).toBeInTheDocument();
  });

  it('offers only All Documents when nothing is categorised', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[makeDoc({ id: 'doc-1', category: null })]}
        canUpload={false}
        canDelete={false}
        categories={orgCategories}
      />,
    );

    await user.click(categoryFilter());

    expect(await screen.findAllByRole('option')).toHaveLength(1);
  });
});

describe('DocumentListClient — Category and Facility columns', () => {
  it('renders the category in its own column, with an em dash when unset', () => {
    render(
      <DocumentListClient
        initialDocs={[
          makeDoc({ id: 'doc-1', filename: 'hr-handbook.pdf', category: 'HR' }),
          makeDoc({ id: 'doc-2', filename: 'legacy.pdf', category: null }),
        ]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'HR' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('badges every row as Global, since documents are org-wide today', () => {
    render(
      <DocumentListClient
        initialDocs={[makeDoc({ id: 'doc-1' }), makeDoc({ id: 'doc-2', filename: 'other.pdf' })]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'Facility' })).toBeInTheDocument();
    expect(screen.getAllByText('Global')).toHaveLength(2);
  });

  it('carries no per-row course link — the row opens the document, whose page links on to the course', () => {
    render(
      <DocumentListClient
        initialDocs={[
          makeDocWithCourse({ id: 'doc-1', filename: 'converted.pdf' }),
          makeDoc({ id: 'doc-2', filename: 'not-converted.pdf' }),
        ]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.queryByRole('link', { name: 'View Course' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('DocumentListClient — bulk selection and delete', () => {
  const twoDocs = [
    makeDoc({ id: 'doc-1', filename: 'a.pdf' }),
    makeDoc({ id: 'doc-2', filename: 'b.pdf' }),
  ];

  function bulkBar() {
    return screen.getByRole('region', { name: 'Bulk actions' });
  }

  it('offers no selection column when the viewer lacks document.delete', () => {
    render(<DocumentListClient initialDocs={twoDocs} canUpload={false} canDelete={false} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the bulk bar with a running count as rows are selected', async () => {
    const user = userEvent.setup();
    render(<DocumentListClient initialDocs={twoDocs} canUpload={false} canDelete={true} />);

    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select a.pdf' }));
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select b.pdf' }));
    expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select a.pdf' }));
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
  });

  it('selects and clears every row on the page from the header checkbox', async () => {
    const user = userEvent.setup();
    render(<DocumentListClient initialDocs={twoDocs} canUpload={false} canDelete={true} />);

    const selectAll = screen.getByRole('checkbox', { name: 'Select all documents on this page' });

    await user.click(selectAll);
    expect(within(bulkBar()).getByText('2 selected')).toBeInTheDocument();

    await user.click(selectAll);
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('deletes every selected document after confirmation', async () => {
    mockDeleteDocument.mockResolvedValue({ success: true });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<DocumentListClient initialDocs={twoDocs} canUpload={false} canDelete={true} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select all documents on this page' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(mockDeleteDocument).toHaveBeenCalledTimes(2);
    expect(mockDeleteDocument).toHaveBeenCalledWith('doc-1');
    expect(mockDeleteDocument).toHaveBeenCalledWith('doc-2');
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('b.pdf')).not.toBeInTheDocument();
  });

  it('includes course-backed documents in bulk delete and warns about their source links', async () => {
    mockDeleteDocument.mockResolvedValue({ success: true });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <DocumentListClient
        initialDocs={[
          makeDoc({ id: 'doc-1', filename: 'a.pdf' }),
          makeDocWithCourse({ id: 'doc-2', filename: 'b.pdf' }),
        ]}
        canUpload={false}
        canDelete={true}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select all documents on this page' }));

    expect(
      within(bulkBar()).getByText(/1 document backs a generated course — deleting removes/),
    ).toBeInTheDocument();

    await user.click(within(bulkBar()).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(mockDeleteDocument).toHaveBeenCalledTimes(2);
    expect(mockDeleteDocument).toHaveBeenCalledWith('doc-1');
    expect(mockDeleteDocument).toHaveBeenCalledWith('doc-2');
  });

  it('keeps bulk delete enabled when every selected document backs a course', async () => {
    const user = userEvent.setup();
    render(
      <DocumentListClient
        initialDocs={[makeDocWithCourse({ id: 'doc-1', filename: 'a.pdf' })]}
        canUpload={false}
        canDelete={true}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select a.pdf' }));

    expect(within(bulkBar()).getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });

  it('reports a partial failure without dropping the rows that survived', async () => {
    mockDeleteDocument
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ error: 'Document not found' });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<DocumentListClient initialDocs={twoDocs} canUpload={false} canDelete={true} />);

    await user.click(screen.getByRole('checkbox', { name: 'Select all documents on this page' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 of 2 documents could not be deleted. Document not found',
    );
    expect(screen.queryByText('a.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();
  });
});

describe('DocumentListClient — Status column semantics', () => {
  it('marks every persisted document Completed, whether or not it became a course', () => {
    render(
      <DocumentListClient
        initialDocs={[
          makeDoc({ id: 'doc-1', filename: 'plain.pdf' }),
          makeDocWithCourse({ id: 'doc-2', filename: 'converted.pdf' }),
        ]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.getAllByText('Completed')).toHaveLength(2);
  });

  it('never shows the old course-pipeline wording in the list', () => {
    render(
      <DocumentListClient
        initialDocs={[makeDocWithCourse({ id: 'doc-1' })]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.queryByText('Converted to Course')).not.toBeInTheDocument();
    expect(screen.queryByText('Uploaded')).not.toBeInTheDocument();
  });

  it('keeps the PHI Flagged badge alongside the status pill', () => {
    render(
      <DocumentListClient
        initialDocs={[
          makeDoc({
            id: 'doc-1',
            versions: [
              { id: 'ver-1', version: 1, courseVersions: [], phiReport: { hasPHI: true } },
            ],
          }),
        ]}
        canUpload={false}
        canDelete={false}
      />,
    );

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('PHI Flagged')).toBeInTheDocument();
  });
});

describe('DocumentListClient — optimistic in-flight upload rows', () => {
  /** Publishes an in-flight batch the way the upload modal does on submit. */
  function StartUploads({ files, category }: { files: File[]; category: string }) {
    const { startUploads } = useUploadProgress();
    useEffect(() => {
      startUploads(files, category);
    }, [startUploads, files, category]);
    return null;
  }

  function renderWithPending(files: File[], category: string, docs: Doc[] = []) {
    return render(
      <UploadProgressProvider>
        <StartUploads files={files} category={category} />
        <DocumentListClient initialDocs={docs} canUpload={true} canDelete={true} />
      </UploadProgressProvider>,
    );
  }

  it('shows an In progress row per in-flight file, with its name and chosen category', () => {
    renderWithPending(
      [new File(['a'], 'policy-one.pdf'), new File(['b'], 'policy-two.pdf')],
      'Compliance',
    );

    expect(screen.getByText('policy-one.pdf')).toBeInTheDocument();
    expect(screen.getByText('policy-two.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('In progress')).toHaveLength(2);
    expect(screen.getAllByRole('cell', { name: 'Compliance' })).toHaveLength(2);
  });

  it('suppresses the empty state while a first upload is still in flight', () => {
    renderWithPending([new File(['a'], 'first.pdf')], 'HR');

    expect(screen.queryByText('No documents found.')).not.toBeInTheDocument();
    expect(screen.queryByText('Upload a document to get started.')).not.toBeInTheDocument();
  });

  it('sits alongside the already-persisted rows rather than replacing them', () => {
    renderWithPending([new File(['a'], 'incoming.pdf')], 'HR', [
      makeDoc({ id: 'doc-1', filename: 'existing.pdf' }),
    ]);

    expect(screen.getByText('existing.pdf')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('incoming.pdf')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('offers no row actions or selection for a row that has no document yet', () => {
    renderWithPending([new File(['a'], 'incoming.pdf')], 'HR');

    expect(screen.queryByTestId('row-actions')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /Select incoming\.pdf/ }),
    ).not.toBeInTheDocument();
  });

  it('shows nothing extra when no upload is running', () => {
    render(
      <UploadProgressProvider>
        <DocumentListClient
          initialDocs={[makeDoc({ id: 'doc-1', filename: 'existing.pdf' })]}
          canUpload={true}
          canDelete={true}
        />
      </UploadProgressProvider>,
    );

    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });
});
