/**
 * Regression tests for the /dashboard/documents server gate (fix 867cda0).
 *
 * The gate switched from `isAdminRole(user.role)` to
 * `can(dbRoleToRoleKey(user.role), 'document.read')` — Finance and every
 * worker role hold no `document.*` grants and must now see the styled
 * access-denied card instead of the real Document Hub, mirroring the
 * Billing/Settings routes' gate pattern (see ../billing/page.test.tsx).
 *
 * `canCreate`/`canEdit`/`canDelete` are derived from the registry
 * (`document.create` / `document.edit` / `document.delete`) and threaded
 * through to `<UploadSection />` and `<DocumentListClient />` — HR holds
 * `document.read` only, so it must reach the real hub with no Upload button
 * and every list prop false.
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

const { mockAuth, prismaMock, mockRedirect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { document: { findMany: vi.fn() } },
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('./upload-section', () => ({
  default: () => <div data-testid="upload-section">Upload New</div>,
}));
vi.mock('./DocumentListClient', () => ({
  default: ({
    initialDocs,
    canUpload,
    canEdit,
    canDelete,
  }: {
    initialDocs: unknown[];
    canUpload: boolean;
    canEdit: boolean;
    canDelete: boolean;
  }) => (
    <div data-testid="document-list-client">
      docs {initialDocs.length} / canUpload {String(canUpload)} / canEdit {String(canEdit)} /
      canDelete {String(canDelete)}
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
const readOnlyRoles = ALL_ROLES.filter((role) => {
  const key = dbRoleToRoleKey(role);
  return can(key, 'document.read') && !can(key, 'document.create');
});
const deniedRoles = ALL_ROLES.filter((role) => !can(dbRoleToRoleKey(role), 'document.read'));

describe('documents registry partition (guards against silent drift)', () => {
  it('accounts for every role in exactly one bucket', () => {
    expect(fullAccessRoles.length + readOnlyRoles.length + deniedRoles.length).toBe(
      ALL_ROLES.length,
    );
  });

  it('matches the current expected partition from the P1-001/P1-003 fix', () => {
    expect(fullAccessRoles.sort()).toEqual(['clinical_director', 'owner', 'supervisor'].sort());
    expect(readOnlyRoles.sort()).toEqual(['hr']);
    expect(deniedRoles).toContain('finance');
    expect(deniedRoles).toContain('psychiatrist_prescriber');
    expect(deniedRoles.length).toBe(9); // finance + 8 worker roles
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.document.findMany.mockResolvedValue([]);
});

describe('DocumentsPageRoute — document.read gate', () => {
  it.each(fullAccessRoles)('renders the full hub with Upload for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.getByTestId('upload-section')).toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload true / canEdit true / canDelete true',
    );
    expect(screen.queryByText(/don.t have access to documents/i)).not.toBeInTheDocument();
  });

  it.each(readOnlyRoles)('renders the read-only hub (no Upload) for %s', async (role) => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'user-1', role, organizationId: 'org-1' } });

    const element = await DocumentsPageRoute();
    render(element);

    expect(screen.queryByTestId('upload-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('document-list-client')).toHaveTextContent(
      'canUpload false / canEdit false / canDelete false',
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

  it('scopes the document query to the caller organization and passes docs through', async () => {
    prismaMock.document.findMany.mockResolvedValueOnce([{ id: 'doc-1' }, { id: 'doc-2' }]);
    mockAuth.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'owner', organizationId: 'org-1' },
    });

    const element = await DocumentsPageRoute();
    render(element);

    expect(prismaMock.document.findMany).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ where: { user: { organizationId: 'org-1' } } }),
    );
    expect(screen.getByTestId('document-list-client')).toHaveTextContent('docs 2');
  });
});
