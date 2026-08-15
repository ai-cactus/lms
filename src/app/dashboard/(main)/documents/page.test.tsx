/**
 * Regression tests for the /dashboard/documents server gate (fix 867cda0).
 *
 * The gate switched from `isAdminRole(user.role)` to
 * `can(dbRoleToRoleKey(user.role), 'document.read')` — Finance and every
 * worker role hold no `document.*` grants and must now see the styled
 * access-denied card instead of the real Document Hub, mirroring the
 * Billing/Settings routes' gate pattern (see ../billing/page.test.tsx).
 *
 * `canCreate`/`canDelete` are derived from the registry (`document.create` /
 * `document.delete`) and threaded through to `<UploadSection />` and
 * `<DocumentListClient />` — a read-only role must reach the real hub with no
 * Upload button and every list prop false.
 *
 * The expected role partition is derived from the live permission registry
 * rather than hardcoded, so this suite tracks the registry automatically if
 * a role's grants change — see the "registry partition" pinning test below
 * for a guard against an unnoticed drift.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { can } from '@/lib/rbac/permissions';
import { ALL_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';

const { mockAuth, prismaMock, mockRedirect, mockGetDocumentCategories } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { document: { findMany: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  mockGetDocumentCategories: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/app/actions/document-categories', () => ({
  getDocumentCategories: mockGetDocumentCategories,
}));
vi.mock('./upload-section', () => ({
  default: ({ categories }: { categories: string[] }) => (
    <div data-testid="upload-section">Upload file / categories {categories.join(',')}</div>
  ),
}));
vi.mock('./DocumentListClient', () => ({
  default: ({
    initialDocs,
    canUpload,
    canDelete,
    categories,
  }: {
    initialDocs: unknown[];
    canUpload: boolean;
    canDelete: boolean;
    categories: string[];
  }) => (
    <div data-testid="document-list-client">
      docs {initialDocs.length} / canUpload {String(canUpload)} / canDelete {String(canDelete)} /
      categories {categories.join(',')}
    </div>
  ),
}));

import DocumentsPageRoute from './page';

// Registry-derived role partition for `document.*` — not hardcoded, so this
// tracks `src/lib/rbac/permissions.ts` automatically.
const fullAccessRoles = ALL_ROLES.filter((role) => {
  const key = dbRoleToRoleKey(role);
  return (
    can(key, 'document.read') &&
    can(key, 'document.create') &&
    can(key, 'document.edit') &&
    can(key, 'document.delete')
  );
});
// Clinical Director: CRU on documents but deletion deliberately withheld — a
// distinct bucket from full CRUD, per the RBAC matrix (see permissions.ts).
const cruNoDeleteRoles = ALL_ROLES.filter((role) => {
  const key = dbRoleToRoleKey(role);
  return (
    can(key, 'document.read') &&
    can(key, 'document.create') &&
    can(key, 'document.edit') &&
    !can(key, 'document.delete')
  );
});
const readOnlyRoles = ALL_ROLES.filter((role) => {
  const key = dbRoleToRoleKey(role);
  return can(key, 'document.read') && !can(key, 'document.create');
});
const deniedRoles = ALL_ROLES.filter((role) => !can(dbRoleToRoleKey(role), 'document.read'));

describe('documents registry partition (guards against silent drift)', () => {
  it('accounts for every role in exactly one bucket', () => {
    expect(
      fullAccessRoles.length + cruNoDeleteRoles.length + readOnlyRoles.length + deniedRoles.length,
    ).toBe(ALL_ROLES.length);
  });

  // Partition updated for the RBAC ruling bundled with the multi-org refactor:
  // hr gained full document CRUD, clinical_director gained CRU-no-delete (new
  // bucket), and supervisor was demoted to read-only.
  it('matches the current expected partition from the RBAC ruling', () => {
    expect(fullAccessRoles.sort()).toEqual(['admin', 'hr', 'owner'].sort());
    expect(cruNoDeleteRoles).toEqual(['clinical_director']);
    expect(readOnlyRoles.sort()).toEqual(['supervisor']);
    expect(deniedRoles).toContain('finance');
    expect(deniedRoles).toContain('psychiatrist_prescriber');
    expect(deniedRoles.length).toBe(9); // finance + 8 worker roles
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.document.findMany.mockResolvedValue([]);
  mockGetDocumentCategories.mockResolvedValue([]);
});

describe('DocumentsPageRoute — document.read gate', () => {
  it.each(fullAccessRoles)('renders the full hub with Upload for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByTestId('upload-section')).toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload true / canDelete true',
    );
    expect(screen.queryByText(/don.t have access to documents/i)).not.toBeInTheDocument();
  });

  it.each(cruNoDeleteRoles)(
    'renders the hub with Upload but canDelete false for %s',
    async (role) => {
      mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

      const element = await DocumentsPageRoute();
      render(element);

      expect(screen.getByTestId('upload-section')).toBeInTheDocument();
      expect(screen.getByTestId('document-list-client')).toHaveTextContent(
        'canUpload true / canDelete false',
      );
      expect(screen.queryByText(/don.t have access to documents/i)).not.toBeInTheDocument();
    },
  );

  it.each(readOnlyRoles)('renders the read-only hub (no Upload) for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.queryByTestId('upload-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload false / canDelete false',
    );
    expect(screen.queryByText(/don.t have access to documents/i)).not.toBeInTheDocument();
  });

  it.each(deniedRoles)('renders the access-denied card instead of the hub for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByText(/don.t have access to documents/i)).toBeInTheDocument();
    expect(screen.queryByTestId('document-list-client')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-section')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it('denies access when the role would pass but the user has no organization', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role: 'owner', organizationId: null } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByText(/don.t have access to documents/i)).toBeInTheDocument();
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(DocumentsPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it("threads the organization's own category vocabulary into the upload modal and the filter", async () => {
    mockGetDocumentCategories.mockResolvedValueOnce(['Clinical', 'HR', 'Other']);
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'owner', organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByTestId('upload-section')).toHaveTextContent('categories Clinical,HR,Other');
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'categories Clinical,HR,Other',
    );
  });

  it('never fetches categories for a role that fails the document.read gate', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'finance', organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(mockGetDocumentCategories).not.toHaveBeenCalled();
  });

  it('scopes the document query to the caller organization and passes docs through', async () => {
    prismaMock.document.findMany.mockResolvedValueOnce([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'owner', organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(prismaMock.document.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { organizationUser: { organizationId: 'org-1' } } }),
    );
    expect(screen.getByTestId('document-list-client')).toHaveTextContent('docs 2');
  });
});
