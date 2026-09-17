/**
 * Regression tests for the /dashboard/documents server gate (fix 867cda0).
 *
 * The gate is `document.read` from the live registry — Finance and every worker
 * role hold no `document.*` grants. Founder ruling Q26
 * (docs/local/RBAC-founder-answers-2026-09-15.md) then changed the DENIAL SHAPE:
 * the styled access-denied card, which named the module it was refusing, is
 * replaced by `notFound()`. `@/auth` is still the mock seam so the REAL
 * `requirePermission` → `evaluatePermission` → registry path runs here; only the
 * session is faked.
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

const { mockAuth, prismaMock, mockRedirect, mockNotFound, mockGetDocumentCategories } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    prismaMock: { document: { findMany: vi.fn() } },
    mockRedirect: vi.fn(() => {
      throw new Error('NEXT_REDIRECT');
    }),
    mockNotFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    }),
    mockGetDocumentCategories: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect, notFound: mockNotFound }));
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
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role, organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByTestId('upload-section')).toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload true / canDelete true',
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it.each(cruNoDeleteRoles)(
    'renders the hub with Upload but canDelete false for %s',
    async (role) => {
      mockAuth.mockResolvedValueOnce({
        user: { id: 'user-1', email: 'gate@test.invalid', role, organizationId: 'org-1' },
      });

      const element = await DocumentsPageRoute();
      render(element);

      expect(screen.getByTestId('upload-section')).toBeInTheDocument();
      expect(screen.getByTestId('document-list-client')).toHaveTextContent(
        'canUpload true / canDelete false',
      );
      expect(mockNotFound).not.toHaveBeenCalled();
    },
  );

  it.each(readOnlyRoles)('renders the read-only hub (no Upload) for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role, organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.queryByTestId('upload-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload false / canDelete false',
    );
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // Q26: hidden in the nav AND "Page not found" on a typed URL. The three
  // assertions are one rule — 404, no redirect, and no copy naming the module.
  it.each(deniedRoles)('404s instead of rendering the hub for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role, organizationId: 'org-1' },
    });

    await expect(DocumentsPageRoute()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it('never renders an access-denied card naming the module', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role: 'finance', organizationId: 'org-1' },
    });

    await expect(DocumentsPageRoute()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(screen.queryByText(/don.t have access to documents/i)).not.toBeInTheDocument();
  });

  // Distinct from the RBAC denial: the role HOLDS document.read and is simply
  // mid-onboarding. It must NOT 404 (that would hide a module it may use) and
  // must not query with `organizationId: null`, which reads as "no filter".
  it('shows the onboarding empty state, not a 404, when the role passes but has no organization', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role: 'owner', organizationId: null },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByText(/no organization found/i)).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  // Unauthenticated is deliberately NOT the Q26 case — /login is somewhere
  // useful to go, and a 404 would strand a logged-out visitor.
  it('redirects to /login when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(DocumentsPageRoute()).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith('/login');
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(prismaMock.document.findMany).not.toHaveBeenCalled();
  });

  it("threads the organization's own category vocabulary into the upload modal and the filter", async () => {
    mockGetDocumentCategories.mockResolvedValueOnce(['Clinical', 'HR', 'Other']);
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role: 'owner', organizationId: 'org-1' },
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
      user: { id: 'user-1', email: 'gate@test.invalid', role: 'finance', organizationId: 'org-1' },
    });

    await expect(DocumentsPageRoute()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockGetDocumentCategories).not.toHaveBeenCalled();
  });

  it('scopes the document query to the caller organization and passes docs through', async () => {
    prismaMock.document.findMany.mockResolvedValueOnce([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', email: 'gate@test.invalid', role: 'owner', organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(prismaMock.document.findMany).toHaveBeenCalledExactlyOnceWith(
      // Q25: ownership is the document's own column. A join through the
      // uploader's membership returns the same rows while undoing the migration.
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
    expect(screen.getByTestId('document-list-client')).toHaveTextContent('docs 2');
  });
});
