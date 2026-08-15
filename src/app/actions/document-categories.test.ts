/**
 * Tests for the org-scoped Document Hub category vocabulary.
 *
 * Two invariants matter most here:
 *   - TENANCY: every read and write is bounded by the caller's
 *     `organizationId`, so no organization can see or extend another's list.
 *   - REGISTRY GATE: reading needs `document.read`, creating needs
 *     `document.create` — mirroring `src/app/actions/documents.ts`.
 *
 * Duplicate handling is deliberately forgiving: a case-insensitive match
 * returns the EXISTING spelling instead of an error, so the upload flow never
 * dead-ends on a category the org already has.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    documentCategory: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDocumentCategories, createDocumentCategory } from './document-categories';
import { audit } from '@/lib/audit';
import {
  DEFAULT_DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_CATEGORY_LENGTH,
  seedDefaultDocumentCategories,
} from '@/lib/documents/document-categories';

const mockAudit = vi.mocked(audit);

function sessionFor(role: string, organizationId: string | null = 'org-1') {
  return { user: { id: 'user-1', email: 'a@b.com', role, organizationId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.documentCategory.findMany.mockResolvedValue([]);
  prismaMock.documentCategory.findFirst.mockResolvedValue(null);
});

describe('getDocumentCategories', () => {
  it('returns the caller organization names, scoped and alphabetised by the query', async () => {
    prismaMock.documentCategory.findMany.mockResolvedValueOnce([
      { name: 'Clinical' },
      { name: 'HR' },
    ]);
    mockAuth.mockResolvedValueOnce(sessionFor('owner'));

    await expect(getDocumentCategories()).resolves.toEqual(['Clinical', 'HR']);

    expect(prismaMock.documentCategory.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { organizationId: 'org-1' },
      select: { name: true },
      orderBy: { name: 'asc' },
    });
  });

  it('never leaks another organization list — the query is always org-bounded', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('owner', 'org-2'));

    await getDocumentCategories();

    expect(prismaMock.documentCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-2' } }),
    );
  });

  it('returns an empty list for a role without document.read, without querying', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('finance'));

    await expect(getDocumentCategories()).resolves.toEqual([]);
    expect(prismaMock.documentCategory.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when the caller has no organization', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('owner', null));

    await expect(getDocumentCategories()).resolves.toEqual([]);
    expect(prismaMock.documentCategory.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(getDocumentCategories()).resolves.toEqual([]);
    expect(prismaMock.documentCategory.findMany).not.toHaveBeenCalled();
  });
});

describe('createDocumentCategory', () => {
  it('creates a trimmed category for the caller organization and audits it', async () => {
    prismaMock.documentCategory.create.mockResolvedValueOnce({
      id: 'cat-1',
      name: 'Clinical Operations',
    });
    mockAuth.mockResolvedValueOnce(sessionFor('owner'));

    await expect(createDocumentCategory('  Clinical Operations  ')).resolves.toEqual({
      name: 'Clinical Operations',
    });

    expect(prismaMock.documentCategory.create).toHaveBeenCalledExactlyOnceWith({
      data: { organizationId: 'org-1', name: 'Clinical Operations' },
      select: { id: true, name: true },
    });
    expect(mockAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: 'document.category.create',
        actorId: 'user-1',
        organizationId: 'org-1',
        targetType: 'document_category',
        targetId: 'cat-1',
      }),
    );
  });

  it('reuses the existing spelling on a case-insensitive duplicate and writes nothing', async () => {
    prismaMock.documentCategory.findFirst.mockResolvedValueOnce({ name: 'Clinical' });
    mockAuth.mockResolvedValueOnce(sessionFor('owner'));

    await expect(createDocumentCategory('cLiNiCaL')).resolves.toEqual({ name: 'Clinical' });

    expect(prismaMock.documentCategory.create).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('scopes the duplicate check to the caller organization', async () => {
    prismaMock.documentCategory.create.mockResolvedValueOnce({ id: 'cat-1', name: 'Intake' });
    mockAuth.mockResolvedValueOnce(sessionFor('owner', 'org-2'));

    await createDocumentCategory('Intake');

    expect(prismaMock.documentCategory.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { organizationId: 'org-2', name: { equals: 'Intake', mode: 'insensitive' } },
      select: { name: true },
    });
    expect(prismaMock.documentCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { organizationId: 'org-2', name: 'Intake' } }),
    );
  });

  it('rejects a role without document.create before touching the database', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('supervisor'));

    await expect(createDocumentCategory('Intake')).resolves.toEqual({
      error: 'You do not have permission to add categories.',
    });

    expect(prismaMock.documentCategory.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.documentCategory.create).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(null);

    await expect(createDocumentCategory('Intake')).resolves.toEqual({
      error: 'Not authenticated or not in an organization',
    });
    expect(prismaMock.documentCategory.create).not.toHaveBeenCalled();
  });

  it('rejects a blank or whitespace-only name', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('owner'));

    await expect(createDocumentCategory('   ')).resolves.toEqual({
      error: 'Category name is required.',
    });
    expect(prismaMock.documentCategory.create).not.toHaveBeenCalled();
  });

  it('rejects a name longer than the shared maximum', async () => {
    mockAuth.mockResolvedValueOnce(sessionFor('owner'));

    const result = await createDocumentCategory('x'.repeat(MAX_DOCUMENT_CATEGORY_LENGTH + 1));

    expect(result.error).toContain(`max ${MAX_DOCUMENT_CATEGORY_LENGTH} characters`);
    expect(prismaMock.documentCategory.create).not.toHaveBeenCalled();
  });
});

describe('seedDefaultDocumentCategories', () => {
  it('seeds the full default vocabulary for one organization inside the caller transaction', async () => {
    const tx = { documentCategory: { createMany: vi.fn() } };

    await seedDefaultDocumentCategories('org-9', tx as never);

    expect(tx.documentCategory.createMany).toHaveBeenCalledExactlyOnceWith({
      data: DEFAULT_DOCUMENT_CATEGORIES.map((name) => ({ organizationId: 'org-9', name })),
      skipDuplicates: true,
    });
  });

  it('seeds exactly the list the backfill migration wrote, so old and new orgs match', () => {
    expect([...DEFAULT_DOCUMENT_CATEGORIES]).toEqual([
      'HR',
      'Compliance',
      'Clinical',
      'Operations',
      'Training',
      'Other',
    ]);
  });
});
