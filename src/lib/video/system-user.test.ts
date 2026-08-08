import { describe, it, expect, vi, beforeEach } from 'vitest';

const userUpsert = vi.fn();
const organizationUpsert = vi.fn();
const organizationUserUpsert = vi.fn();

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { upsert: (...a: unknown[]) => userUpsert(...a) },
    organization: { upsert: (...a: unknown[]) => organizationUpsert(...a) },
    organizationUser: { upsert: (...a: unknown[]) => organizationUserUpsert(...a) },
  };
  return { prisma, default: prisma };
});

import { getOrCreateSystemUser, SYSTEM_USER_EMAIL } from './system-user';

beforeEach(() => {
  userUpsert.mockReset();
  organizationUpsert.mockReset();
  organizationUserUpsert.mockReset();
});

describe('getOrCreateSystemUser', () => {
  it('upserts the system User by email with a random password', async () => {
    userUpsert.mockResolvedValue({ id: 'sys-user-1', email: SYSTEM_USER_EMAIL });
    organizationUpsert.mockResolvedValue({ id: 'sys-org-1', slug: 'system' });
    organizationUserUpsert.mockResolvedValue({
      id: 'sys-ou-1',
      userId: 'sys-user-1',
      organizationId: 'sys-org-1',
      role: 'admin',
    });

    await getOrCreateSystemUser();

    const arg = userUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ email: SYSTEM_USER_EMAIL });
    expect(arg.update).toEqual({});
    expect(arg.create.email).toBe(SYSTEM_USER_EMAIL);
    expect(arg.create.emailVerified).toBe(true);
    expect(typeof arg.create.password).toBe('string');
    expect(arg.create.password.length).toBeGreaterThan(0);
  });

  it('upserts the dedicated "system" Organization by slug', async () => {
    userUpsert.mockResolvedValue({ id: 'sys-user-1', email: SYSTEM_USER_EMAIL });
    organizationUpsert.mockResolvedValue({ id: 'sys-org-1', slug: 'system' });
    organizationUserUpsert.mockResolvedValue({
      id: 'sys-ou-1',
      userId: 'sys-user-1',
      organizationId: 'sys-org-1',
      role: 'admin',
    });

    await getOrCreateSystemUser();

    const arg = organizationUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: 'system' });
    expect(arg.update).toEqual({});
    expect(arg.create).toEqual({ name: 'System', slug: 'system' });
  });

  it('upserts an admin-role OrganizationUser membership linking the two and returns it', async () => {
    userUpsert.mockResolvedValue({ id: 'sys-user-1', email: SYSTEM_USER_EMAIL });
    organizationUpsert.mockResolvedValue({ id: 'sys-org-1', slug: 'system' });
    organizationUserUpsert.mockResolvedValue({
      id: 'sys-ou-1',
      userId: 'sys-user-1',
      organizationId: 'sys-org-1',
      role: 'admin',
    });

    const result = await getOrCreateSystemUser();

    const arg = organizationUserUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId_organizationId: { userId: 'sys-user-1', organizationId: 'sys-org-1' },
    });
    expect(arg.update).toEqual({});
    // Owner-equivalent full-access role — this membership authors global (isGlobal) courses.
    expect(arg.create).toEqual({
      userId: 'sys-user-1',
      organizationId: 'sys-org-1',
      role: 'admin',
    });
    expect(result).toEqual({
      id: 'sys-ou-1',
      userId: 'sys-user-1',
      organizationId: 'sys-org-1',
      role: 'admin',
    });
  });
});
