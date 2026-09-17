/**
 * The document VIEWER's delete button carries its own copy of the confirmation
 * dialog (the Documents hub row has the other). Both describe the same Q24
 * behaviour, so both are pinned — ISSUE-1 on staging was exactly this copy
 * drifting behind the behaviour it describes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockDeleteDocument, mockPush, mockRefresh } = vi.hoisted(() => ({
  mockDeleteDocument: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@/app/actions/documents', () => ({ deleteDocument: mockDeleteDocument }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import DocumentDeleteButton from './DocumentDeleteButton';

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteDocument.mockResolvedValue({ success: true });
});

describe('DocumentDeleteButton — confirmation copy', () => {
  it('ISSUE-1: describes archive-and-retain, never a permanent delete', async () => {
    const user = userEvent.setup();

    render(
      <DocumentDeleteButton documentId="doc-1" filename="policy.pdf" hasLinkedCourse={false} />,
    );

    await user.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = screen.getByRole('alertdialog');

    expect(dialog).toHaveTextContent(/retained for compliance/i);
    expect(dialog).toHaveTextContent(/nothing is erased/i);
    // No in-product restore exists, so the copy must not imply one either.
    expect(dialog).not.toHaveTextContent(/permanently remove/i);
    expect(dialog).not.toHaveTextContent(/cannot be undone/i);
    expect(dialog).not.toHaveTextContent(/restore it/i);
  });

  it('tells a course-backed document’s owner the course survives but can no longer open it', async () => {
    const user = userEvent.setup();

    render(<DocumentDeleteButton documentId="doc-1" filename="policy.pdf" hasLinkedCourse />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      /that course is unaffected, but it will no longer be able to open this document/i,
    );
  });
});
