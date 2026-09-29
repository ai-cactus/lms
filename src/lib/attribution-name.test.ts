import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockLoggerError } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = { organizationUser: { findUnique: mockFindUnique } };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
}));

import { resolveAttributionName } from './attribution-name';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveAttributionName (BUG-25)', () => {
  it('reads the full name from the membership the FK points at, trimmed', async () => {
    mockFindUnique.mockResolvedValue({ user: { fullName: '  Ada Approver ' } });

    await expect(resolveAttributionName('ou-1')).resolves.toBe('Ada Approver');
    expect(mockFindUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'ou-1' },
      select: { user: { select: { fullName: true } } },
    });
  });

  it.each([null, undefined, ''])('returns null without a query for the id %j', async (id) => {
    await expect(resolveAttributionName(id)).resolves.toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['no member', null],
    ['no full name', { user: { fullName: null } }],
    ['a blank full name', { user: { fullName: '   ' } }],
  ])('returns null — never an email — for %s', async (_label, row) => {
    mockFindUnique.mockResolvedValue(row);

    await expect(resolveAttributionName('ou-1')).resolves.toBeNull();
  });

  it('logs and returns null rather than failing the write it rides on', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));

    await expect(resolveAttributionName('ou-1')).resolves.toBeNull();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ organizationUserId: 'ou-1', err: expect.any(Error) }),
    );
  });
});
