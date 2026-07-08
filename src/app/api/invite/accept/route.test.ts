/**
 * Regression tests for POST /api/invite/accept.
 *
 * Companion to the /join/[token] page fix: token lookup here was already a
 * `findUnique` (token is `@unique`), but these tests guard the same class of
 * bug — a missing/blank token must never reach the database, and a valid
 * token must create the account under exactly THAT invite's organization and
 * role, never some other invite's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { prismaMock, mockLogger, mockBcryptHash } = vi.hoisted(() => ({
  prismaMock: {
    invite: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockBcryptHash: vi.fn().mockResolvedValue('hashed-password'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));
vi.mock('bcryptjs', () => ({
  default: { hash: mockBcryptHash, compare: vi.fn() },
  hash: mockBcryptHash,
  compare: vi.fn(),
}));

import { POST } from './route';

const VALID_PASSWORD = 'StrongPass1!';
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function makeReq(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBcryptHash.mockResolvedValue('hashed-password');
  prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-1' });
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb) =>
    cb({
      user: { create: prismaMock.user.create },
      invite: { update: prismaMock.invite.update },
    }),
  );
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-1' });
});

describe('POST /api/invite/accept — missing/blank token', () => {
  it('rejects an empty token with 4xx and never queries or creates an account', async () => {
    const res = await POST(
      makeReq({ token: '', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects a payload missing the token field entirely', async () => {
    const res = await POST(
      makeReq({ firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/invite/accept — invalid or expired token', () => {
  it('rejects an unknown token and creates no account', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({
        token: 'nonexistent',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it('rejects an expired invite and creates no account', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-expired',
      token: 'tok-expired',
      email: 'expired@acme.com',
      organizationId: 'org-1',
      role: 'nurse',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(
      makeReq({
        token: 'tok-expired',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/invite/accept — valid token', () => {
  it('creates the account under exactly the requested token’s organization and role', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
      role: 'nurse',
      expiresAt: FUTURE,
    });

    const res = await POST(
      makeReq({
        token: 'tok-correct',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.invite.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { token: 'tok-correct', status: 'pending' },
    });
    expect(prismaMock.user.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        email: 'newhire@acme.com',
        organizationId: 'org-correct',
        role: 'nurse',
        facilityId: 'facility-1',
      }),
    });
    expect(prismaMock.invite.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-correct' },
      data: { status: 'accepted' },
    });
  });

  it('rejects when a user already exists for the invite email, without creating a duplicate', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      token: 'tok-1',
      email: 'existing@acme.com',
      organizationId: 'org-1',
      role: 'nurse',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'already-there' });

    const res = await POST(
      makeReq({ token: 'tok-1', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});
