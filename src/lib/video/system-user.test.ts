import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsert = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { upsert: (...a: unknown[]) => upsert(...a) } },
}));

import { getOrCreateSystemUser, SYSTEM_USER_EMAIL } from './system-user';

beforeEach(() => upsert.mockReset());

describe('getOrCreateSystemUser', () => {
  it('upserts a deterministic admin user by email and returns it', async () => {
    upsert.mockResolvedValue({ id: 'sys-1', email: SYSTEM_USER_EMAIL });
    const user = await getOrCreateSystemUser();
    expect(user.id).toBe('sys-1');
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ email: SYSTEM_USER_EMAIL });
    expect(arg.create.role).toBe('admin');
    expect(arg.create.organizationId).toBeNull();
    expect(arg.update).toEqual({});
    expect(typeof arg.create.password).toBe('string');
    expect(arg.create.password.length).toBeGreaterThan(0);
  });
});
