/**
 * Regression tests for the full-screen document viewer's meta line.
 *
 * Per the approved design the line carries the facility scope chip and the
 * upload time only — the version, file size, "Converted to Course" status and
 * the linked-course link were deliberately removed and must not come back (nor
 * be re-homed anywhere else on the page).
 */
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOCUMENT_CONVERTED_LABEL } from '@/lib/documents/status';
import { formatFileSize } from '@/lib/utils';

const { mockAuth, prismaMock, mockNotFound, mockGetDocumentSignedUrl } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    document: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetDocumentSignedUrl: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/app/actions/storage', () => ({ getDocumentSignedUrl: mockGetDocumentSignedUrl }));
vi.mock('@/components/dashboard/NavBar', () => ({
  UserProfileMenu: ({ fullName }: { fullName: string }) => <div>{fullName}</div>,
}));
vi.mock('@/components/dashboard/documents/DocumentDeleteButton', () => ({
  default: () => <button type="button">Delete</button>,
}));
vi.mock('@/components/dashboard/documents/PdfViewerDynamic', () => ({
  default: ({ fileUrl, meta }: { fileUrl: string; meta?: ReactNode }) => (
    <div data-testid="pdf-viewer" data-file-url={fileUrl}>
      {meta}
    </div>
  ),
}));

import DocumentViewerPage from './page';

const ORG_ID = 'org-1';
const COURSE_TITLE = 'Patient Privacy Policy Course';
const FILE_SIZE = 248_000;

function buildDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    filename: 'Patient Privacy Policy.pdf',
    mimeType: 'application/pdf',
    size: FILE_SIZE,
    updatedAt: new Date(),
    organizationUser: { organizationId: ORG_ID },
    versions: [
      {
        id: 'ver-1',
        version: 3,
        content: null,
        phiReport: null,
        courseVersions: [{ id: 'cv-1' }],
      },
    ],
    ...overrides,
  };
}

async function renderPage() {
  const ui = await DocumentViewerPage({ params: Promise.resolve({ id: 'doc-1' }) });
  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'user-1', role: 'admin', organizationId: ORG_ID, name: 'Jane Doe' },
  });
  prismaMock.document.findUnique.mockResolvedValue(buildDocument());
  prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Jane Doe' });
  mockGetDocumentSignedUrl.mockResolvedValue({ url: 'https://storage.test/signed' });
});

describe('DocumentViewerPage meta line', () => {
  it('shows only the facility chip and the upload time', async () => {
    await renderPage();

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText(/^Uploaded .+$/)).toBeInTheDocument();

    expect(screen.queryByText('v3')).not.toBeInTheDocument();
    expect(screen.queryByText(formatFileSize(FILE_SIZE))).not.toBeInTheDocument();
    expect(screen.queryByText(DOCUMENT_CONVERTED_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(COURSE_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COURSE_TITLE })).not.toBeInTheDocument();
  });

  it('renders the meta line inside the PDF viewer so it sits beside the thumbnail rail', async () => {
    await renderPage();

    const viewer = screen.getByTestId('pdf-viewer');
    expect(viewer).toHaveAttribute('data-file-url', '/api/documents/ver-1/preview');
    expect(viewer).toHaveTextContent('Global');
  });

  it('keeps the top bar chrome intact', async () => {
    await renderPage();

    expect(screen.getByRole('link', { name: /Documents/ })).toHaveAttribute(
      'href',
      '/dashboard/documents',
    );
    expect(screen.getByRole('heading', { name: 'Patient Privacy Policy.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('falls back to the extracted text for a non-PDF document, meta line included', async () => {
    prismaMock.document.findUnique.mockResolvedValue(
      buildDocument({
        filename: 'Onboarding Handbook.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        versions: [
          {
            id: 'ver-1',
            version: 1,
            content: 'Extracted handbook text',
            phiReport: null,
            courseVersions: [],
          },
        ],
      }),
    );

    await renderPage();

    expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
    expect(screen.getByText('Extracted handbook text')).toBeInTheDocument();
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows the unpreviewable notice when a non-PDF document has no extracted text', async () => {
    prismaMock.document.findUnique.mockResolvedValue(
      buildDocument({
        filename: 'Scan.tiff',
        mimeType: 'image/tiff',
        versions: [
          {
            id: 'ver-1',
            version: 1,
            content: null,
            phiReport: null,
            courseVersions: [],
          },
        ],
      }),
    );

    await renderPage();

    expect(screen.getByText('Preview not available for this file type.')).toBeInTheDocument();
  });
});

/**
 * The access gate. `/dashboard/documents` moved to the registry in 867cda0, but
 * this detail route kept `isAdminRole` — and ADMIN_ROLES includes `finance`,
 * which holds no `document.*` grant at all. The list was closed while the record
 * behind it stayed reachable by direct URL.
 */
describe('DocumentViewerPage access gate', () => {
  it('refuses Finance — in ADMIN_ROLES, but holds no document.read', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-f', role: 'finance', organizationId: ORG_ID, name: 'Fin Ance' },
    });

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('still admits HR, which does hold document.read', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-h', role: 'hr', organizationId: ORG_ID, name: 'H R' },
    });

    await expect(renderPage()).resolves.toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('treats a cross-org document as not found rather than forbidden — existence must not leak', async () => {
    prismaMock.document.findUnique.mockResolvedValue(
      buildDocument({ organizationUser: { organizationId: 'other-org' } }),
    );

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
