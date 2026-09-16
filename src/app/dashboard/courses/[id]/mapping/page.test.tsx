/**
 * The compliance-mapping page previously called `await auth()` and DISCARDED
 * the result: no role check, no tenancy predicate, and a `findUnique` by bare
 * course id. Since `src/proxy.ts` is two-bucket and does no module-level check,
 * every admin-tier role reached this URL and read any organisation's raw
 * source-document text.
 *
 * Two properties are pinned here: the page resolves its gate through
 * `requirePermission('document.read', { onDeny: 'notFound' })`, and the course
 * lookup carries the caller's organisation so another tenant's course id is
 * indistinguishable from one that does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockRequirePermission, mockNotFound, mockGetMappingSuggestions } = vi.hoisted(
  () => ({
    prismaMock: { course: { findFirst: vi.fn(), findUnique: vi.fn() } },
    mockRequirePermission: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new Error('NEXT_NOT_FOUND');
    }),
    mockGetMappingSuggestions: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/rbac/require-permission', () => ({ requirePermission: mockRequirePermission }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/app/actions/mapping', () => ({ getMappingSuggestions: mockGetMappingSuggestions }));
vi.mock('./mapping-card', () => ({ default: () => null }));

import MappingPage from './page';

const params = Promise.resolve({ id: 'course-1' });

function allow(organizationId: string | null = 'org-1') {
  mockRequirePermission.mockResolvedValue({
    userId: 'user-1',
    role: 'hr',
    roleKey: 'hr',
    organizationId,
    organizationUserId: 'ou-1',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMappingSuggestions.mockResolvedValue([]);
});

describe('MappingPage', () => {
  it('gates on document.read and 404s (never redirects) on deny', async () => {
    allow();
    prismaMock.course.findFirst.mockResolvedValue({
      id: 'course-1',
      versions: [{ documentVersion: { id: 'dv-1', content: 'policy text' } }],
    });

    await MappingPage({ params });

    expect(mockRequirePermission).toHaveBeenCalledWith('document.read', { onDeny: 'notFound' });
  });

  it('propagates the guard refusal without reading any course', async () => {
    mockRequirePermission.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(MappingPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(prismaMock.course.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });

  it('scopes the course lookup to the caller organisation', async () => {
    allow('org-1');
    prismaMock.course.findFirst.mockResolvedValue({
      id: 'course-1',
      versions: [{ documentVersion: { id: 'dv-1', content: 'policy text' } }],
    });

    await MappingPage({ params });

    expect(prismaMock.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'course-1', creator: { organizationId: 'org-1' } },
      }),
    );
  });

  it('404s for a course outside the caller organisation', async () => {
    allow('org-1');
    prismaMock.course.findFirst.mockResolvedValue(null);

    await expect(MappingPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  // Fail closed: an org-less session must see nothing, not every course. Without
  // the guard an `organizationId: undefined` predicate would read as "no filter".
  it('404s without querying when the session has no active organisation', async () => {
    allow(null);

    await expect(MappingPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(prismaMock.course.findFirst).not.toHaveBeenCalled();
  });

  it('404s when the course has no source version', async () => {
    allow();
    prismaMock.course.findFirst.mockResolvedValue({ id: 'course-1', versions: [] });

    await expect(MappingPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
