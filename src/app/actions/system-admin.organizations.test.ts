/**
 * The /system console's organization actions.
 *
 *  - every action re-checks the system-admin cookie and THROWS only
 *    `Unauthorized`; every other refusal is RETURNED (a thrown Server Action
 *    error is redacted in production);
 *  - `deleteOrganization` re-validates the typed organization name and the
 *    word DELETE on the server, and rate-limits fail-closed;
 *  - `getAllOrganizations` hides deleted organizations unless asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockPrisma,
  mockSoftDelete,
  mockRestore,
  mockPreviewDelete,
  mockPreviewRestore,
  mockVerifyCookie,
  mockRevalidatePath,
  mockCheckRateLimit,
} = vi.hoisted(() => ({
  mockPrisma: {
    organization: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    organizationUser: { groupBy: vi.fn() },
  },
  mockSoftDelete: vi.fn(),
  mockRestore: vi.fn(),
  mockPreviewDelete: vi.fn(),
  mockPreviewRestore: vi.fn(),
  mockVerifyCookie: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma, default: mockPrisma }));
vi.mock('@/db/index', () => ({ rawPrisma: {} }));
vi.mock('@/lib/system/delete-user', () => ({
  softDeleteUser: vi.fn(),
  findOwnershipBlocks: vi.fn(),
  describeOwnershipBlocks: vi.fn(),
}));
vi.mock('@/lib/system/delete-organization', () => ({
  softDeleteOrganization: mockSoftDelete,
  restoreOrganization: mockRestore,
  previewOrganizationSoftDelete: mockPreviewDelete,
  previewOrganizationRestore: mockPreviewRestore,
}));
vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifyCookie,
  SYSTEM_ADMIN_COOKIE: 'system_admin_auth',
}));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest-agent' }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/audit', () => ({
  audit: vi.fn(),
  getClientContext: (h: Headers) => ({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

import {
  deleteOrganization,
  getAllOrganizations,
  getOrganizationDeletePreview,
  getOrganizationDetail,
  getOrganizationRestorePreview,
  restoreOrganization,
} from './system-admin';

const ORG_ID = 'org-1';
const CONFIRM = { confirmName: 'Acme Health', confirmWord: 'DELETE' };
const CREATED = new Date('2026-01-01T00:00:00Z');
const DELETED_AT = new Date('2026-10-08T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCookie.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
  mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme Health' });
});

describe('unauthenticated callers', () => {
  it.each([
    ['getAllOrganizations', () => getAllOrganizations({})],
    ['getOrganizationDetail', () => getOrganizationDetail(ORG_ID)],
    ['getOrganizationDeletePreview', () => getOrganizationDeletePreview(ORG_ID)],
    ['getOrganizationRestorePreview', () => getOrganizationRestorePreview(ORG_ID)],
    ['deleteOrganization', () => deleteOrganization(ORG_ID, CONFIRM)],
    ['restoreOrganization', () => restoreOrganization(ORG_ID)],
  ])('%s throws Unauthorized and touches nothing', async (_name, call) => {
    mockVerifyCookie.mockResolvedValue(false);

    await expect(call()).rejects.toThrow('Unauthorized');

    expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.organization.findMany).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockSoftDelete).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockPreviewDelete).not.toHaveBeenCalled();
    expect(mockPreviewRestore).not.toHaveBeenCalled();
  });
});

describe('deleteOrganization', () => {
  it('soft-deletes with the system-admin audit context and revalidates the list and detail pages', async () => {
    mockSoftDelete.mockResolvedValue({ status: 'deleted', membershipsDeactivated: 4 });

    const result = await deleteOrganization(ORG_ID, CONFIRM);

    expect(result).toEqual({ success: true, membershipsDeactivated: 4 });
    expect(mockSoftDelete).toHaveBeenCalledWith(ORG_ID, {
      actorRole: 'system_admin',
      ip: '203.0.113.9',
      userAgent: 'vitest-agent',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/system/organizations');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/system/organizations/${ORG_ID}`);
  });

  it.each([
    ['a wrong name', { confirmName: 'Acme Healt', confirmWord: 'DELETE' }],
    ['a name with different case', { confirmName: 'acme health', confirmWord: 'DELETE' }],
    ['a name with trailing whitespace', { confirmName: 'Acme Health ', confirmWord: 'DELETE' }],
    ['an empty name', { confirmName: '', confirmWord: 'DELETE' }],
    ['a wrong word', { confirmName: 'Acme Health', confirmWord: 'delete' }],
    ['an empty word', { confirmName: 'Acme Health', confirmWord: '' }],
  ])('returns an error for %s and deletes nothing', async (_label, confirmation) => {
    const result = await deleteOrganization(ORG_ID, confirmation);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exactly to confirm/i);
    expect(mockSoftDelete).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('is rate limited fail-closed per IP, and a limited call deletes nothing', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 600 });

    const result = await deleteOrganization(ORG_ID, CONFIRM);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'system-admin-destructive:203.0.113.9',
      10,
      900,
      {
        failClosed: true,
      },
    );
    expect(result).toEqual({
      success: false,
      error: 'Too many attempts. Please wait 600 seconds and try again.',
    });
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('answers Organization not found for an unknown id without calling the lib', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    await expect(deleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Organization not found',
    });
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it.each([
    [
      'already_deleted',
      { status: 'already_deleted', deletedAt: DELETED_AT },
      'This organization was already deleted on 2026-10-08.',
    ],
    [
      'refused',
      { status: 'refused', message: 'The internal System organization cannot be deleted.' },
      'The internal System organization cannot be deleted.',
    ],
    ['not_found', { status: 'not_found' }, 'Organization not found'],
  ])(
    'returns the %s outcome as an error value without revalidating',
    async (_s, outcome, error) => {
      mockSoftDelete.mockResolvedValue(outcome);

      await expect(deleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({ success: false, error });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    },
  );

  it('returns a safe error instead of throwing when the lib fails', async () => {
    mockSoftDelete.mockRejectedValue(new Error('connection reset'));

    await expect(deleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Failed to delete organization. Please try again.',
    });
  });
});

describe('restoreOrganization', () => {
  it('restores, reports the members brought back and revalidates', async () => {
    mockRestore.mockResolvedValue({ status: 'restored', membershipsReactivated: 3 });

    const result = await restoreOrganization(ORG_ID);

    expect(result).toEqual({ success: true, membershipsReactivated: 3 });
    expect(mockRestore).toHaveBeenCalledWith(ORG_ID, {
      actorRole: 'system_admin',
      ip: '203.0.113.9',
      userAgent: 'vitest-agent',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/system/organizations/${ORG_ID}`);
  });

  it('is rate limited with the same fail-closed bucket as delete', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 30 });

    const result = await restoreOrganization(ORG_ID);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'system-admin-destructive:203.0.113.9',
      10,
      900,
      {
        failClosed: true,
      },
    );
    expect(result.success).toBe(false);
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it.each([
    ['blocked', { status: 'blocked', message: 'No owner.' }, 'No owner.'],
    ['not_deleted', { status: 'not_deleted' }, 'This organization is not deleted.'],
    ['not_found', { status: 'not_found' }, 'Organization not found'],
  ])('returns the %s outcome as an error value', async (_s, outcome, error) => {
    mockRestore.mockResolvedValue(outcome);

    await expect(restoreOrganization(ORG_ID)).resolves.toEqual({ success: false, error });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns a safe error instead of throwing when the lib fails', async () => {
    mockRestore.mockRejectedValue(new Error('deadlock'));

    await expect(restoreOrganization(ORG_ID)).resolves.toEqual({
      success: false,
      error: 'Failed to restore organization. Please try again.',
    });
  });
});

describe('previews', () => {
  it('delegates to the lib previews for a signed-in admin', async () => {
    mockPreviewDelete.mockResolvedValue({ marker: 'delete' });
    mockPreviewRestore.mockResolvedValue({ marker: 'restore' });

    await expect(getOrganizationDeletePreview(ORG_ID)).resolves.toEqual({ marker: 'delete' });
    await expect(getOrganizationRestorePreview(ORG_ID)).resolves.toEqual({ marker: 'restore' });
    expect(mockPreviewDelete).toHaveBeenCalledWith(ORG_ID);
    expect(mockPreviewRestore).toHaveBeenCalledWith(ORG_ID);
  });
});

describe('getAllOrganizations', () => {
  const row = (id: string, deletedAt: Date | null) => ({
    id,
    name: `Org ${id}`,
    slug: `org-${id}`,
    deletedAt,
    createdAt: CREATED,
    subscription: { plan: 'growth', status: 'active' },
    _count: { organizationUsers: 5, facilities: 2 },
  });

  beforeEach(() => {
    mockPrisma.organization.findMany.mockResolvedValue([row('a', null), row('b', DELETED_AT)]);
    mockPrisma.organization.count.mockResolvedValue(2);
    mockPrisma.organizationUser.groupBy.mockResolvedValue([
      { organizationId: 'a', _count: { _all: 2 } },
    ]);
  });

  const whereOf = () => mockPrisma.organization.findMany.mock.calls[0][0].where;

  it('hides deleted organizations by default', async () => {
    await getAllOrganizations({});

    expect(whereOf()).toEqual({ deletedAt: null });
    expect(mockPrisma.organization.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it.each([
    ['active', { deletedAt: null }],
    ['deleted', { deletedAt: { not: null } }],
    ['all', {}],
  ] as const)('filters status=%s', async (statusFilter, expected) => {
    await getAllOrganizations({ statusFilter });

    expect(whereOf()).toEqual(expected);
  });

  it('searches name and slug case-insensitively from two characters, and ignores a one-character search', async () => {
    await getAllOrganizations({ search: ' ac ' });
    expect(whereOf()).toEqual({
      deletedAt: null,
      OR: [
        { name: { contains: 'ac', mode: 'insensitive' } },
        { slug: { contains: 'ac', mode: 'insensitive' } },
      ],
    });

    mockPrisma.organization.findMany.mockClear();
    await getAllOrganizations({ search: 'a' });
    expect(whereOf()).toEqual({ deletedAt: null });
  });

  it('maps rows with member, owner and facility counts and clamps paging', async () => {
    const result = await getAllOrganizations({ page: -3, limit: 5000 });

    expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );
    expect(result.page).toBe(1);
    expect(result.organizations).toEqual([
      {
        id: 'a',
        name: 'Org a',
        slug: 'org-a',
        deletedAt: null,
        createdAt: CREATED,
        memberCount: 5,
        ownerCount: 2,
        facilityCount: 2,
        subscription: { plan: 'growth', status: 'active' },
      },
      expect.objectContaining({ id: 'b', deletedAt: DELETED_AT, ownerCount: 0 }),
    ]);
    expect(mockPrisma.organizationUser.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: { in: ['a', 'b'] }, active: true, role: 'owner' },
      }),
    );
  });
});
