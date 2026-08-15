/**
 * Tests for the audit trail's two durability tiers (F-079).
 *
 * The distinction is the whole point, so it is what these tests pin:
 *
 *   audit()         — swallows failures. Right for telemetry; a view-logged
 *                     event is not worth failing a request over.
 *   auditCritical() — throws, and can join the caller's transaction. For the
 *                     events an auditor will ask about, where a missing row
 *                     changes what you can claim.
 *
 * A single swallow-everything helper made the trail unprovable: a partial outage
 * would leave silent gaps discoverable only when someone asked for the record.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockLogger } = vi.hoisted(() => ({
  prismaMock: { auditLog: { create: vi.fn() } },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/generated/prisma/client', () => ({ Prisma: {} }));

import { audit, auditCritical, getClientContext } from './audit';

const ENTRY = {
  action: 'auth.login.success',
  actorId: 'user-1',
  actorRole: 'admin',
  organizationId: 'org-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.create.mockResolvedValue({ id: 'log-1' });
});

describe('audit — best-effort tier', () => {
  it('writes the row with the supplied context', async () => {
    await audit({ ...ENTRY, ip: '203.0.113.5', userAgent: 'curl/8' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'auth.login.success',
      actorId: 'user-1',
      ip: '203.0.113.5',
      userAgent: 'curl/8',
    });
  });

  // The documented contract: a telemetry failure must never break the caller.
  it('never throws when the write fails, and logs instead', async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error('db down'));

    await expect(audit(ENTRY)).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0].msg).toContain('Failed to write audit log');
  });
});

describe('auditCritical — provable tier', () => {
  it('writes the row like audit() does', async () => {
    await auditCritical(ENTRY);

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'auth.login.success',
    });
  });

  /**
   * The F-079 fix. If this swallowed errors like audit(), a partial outage would
   * silently drop the exact records an auditor asks for, and nobody would know
   * until the record was requested.
   */
  it('THROWS when the write fails so the caller must decide', async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error('db down'));

    await expect(auditCritical(ENTRY)).rejects.toThrow('db down');
    // It must not quietly downgrade to a log line.
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('uses the supplied transaction client so the row commits with the mutation', async () => {
    const tx = { auditLog: { create: vi.fn().mockResolvedValue({}) } };

    await auditCritical({ ...ENTRY, action: 'staff.role.change' }, tx as never);

    // Written through the transaction, never the standalone client — that is
    // what makes the mutation and its audit row atomic.
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('propagates a transactional failure so the caller rolls back', async () => {
    const tx = { auditLog: { create: vi.fn().mockRejectedValue(new Error('conflict')) } };

    await expect(auditCritical(ENTRY, tx as never)).rejects.toThrow('conflict');
  });
});

describe('getClientContext', () => {
  it('takes the first entry of a comma-separated x-forwarded-for', async () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.5, 70.41.3.18',
      'user-agent': 'Mozilla/5.0',
    });

    expect(getClientContext(headers)).toEqual({
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('falls back to x-real-ip', async () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.7' });
    expect(getClientContext(headers).ip).toBe('198.51.100.7');
  });
});
