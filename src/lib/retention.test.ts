/**
 * Unit tests for src/lib/retention.ts
 *
 * runRetentionPurge covered:
 *   - Each purge deletes with the correct terminal-state filter and time cutoff
 *   - Windows honor their env overrides; bad/negative overrides fall back to defaults
 *   - audit_logs are NEVER touched (no auditLog delegate call)
 *   - Best-effort: a failing delete is swallowed (logged), others still run,
 *     and the returned count for the failed table is 0
 *   - The returned summary reflects each deleteMany's count
 *
 * Time: fixed NOW = 2024-06-15T00:00:00Z; cutoffs are NOW minus the window in
 * whole days (24h each), computed off absolute time (no tz involved).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────────────────

const { prismaMock, mockLoggerError } = vi.hoisted(() => {
  const prismaMock = {
    verificationToken: { deleteMany: vi.fn() },
    invite: { deleteMany: vi.fn() },
    job: { deleteMany: vi.fn() },
    emailMessage: { deleteMany: vi.fn() },
    auditLog: { deleteMany: vi.fn() },
  };
  const mockLoggerError = vi.fn();
  return { prismaMock, mockLoggerError };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import { runRetentionPurge } from './retention';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = new Date('2024-06-15T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** The expected cutoff instant `days` before NOW. */
function cutoff(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** Env vars this module reads; saved/restored per test. */
const ENV_KEYS = [
  'RETENTION_VERIFICATION_TOKEN_GRACE_DAYS',
  'RETENTION_INVITE_DAYS',
  'RETENTION_JOB_DAYS',
  'RETENTION_EMAIL_DAYS',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
    delete process.env[key];
  }
  // Default: every delete succeeds with a distinct count.
  prismaMock.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.invite.deleteMany.mockResolvedValue({ count: 2 });
  prismaMock.job.deleteMany.mockResolvedValue({ count: 3 });
  prismaMock.emailMessage.deleteMany.mockResolvedValue({ count: 4 });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// ─── Window / filter correctness ──────────────────────────────────────────────

describe('runRetentionPurge — default windows', () => {
  it('purges expired verification tokens past the default 1-day grace', async () => {
    await runRetentionPurge(NOW);
    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expires: { lt: cutoff(1) } },
    });
  });

  it('purges terminal invites older than the default 30-day window', async () => {
    await runRetentionPurge(NOW);
    expect(prismaMock.invite.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['accepted', 'expired'] },
        createdAt: { lt: cutoff(30) },
      },
    });
  });

  it('purges terminal jobs older than the default 90-day window', async () => {
    await runRetentionPurge(NOW);
    expect(prismaMock.job.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['completed', 'failed'] },
        updatedAt: { lt: cutoff(90) },
      },
    });
  });

  it('purges sent email messages older than the default 90-day window', async () => {
    await runRetentionPurge(NOW);
    expect(prismaMock.emailMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'sent',
        sentAt: { lt: cutoff(90) },
      },
    });
  });
});

describe('runRetentionPurge — env-configurable windows', () => {
  it('honors each RETENTION_* override', async () => {
    process.env.RETENTION_VERIFICATION_TOKEN_GRACE_DAYS = '3';
    process.env.RETENTION_INVITE_DAYS = '7';
    process.env.RETENTION_JOB_DAYS = '45';
    process.env.RETENTION_EMAIL_DAYS = '120';

    await runRetentionPurge(NOW);

    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expires: { lt: cutoff(3) } },
    });
    expect(prismaMock.invite.deleteMany).toHaveBeenCalledWith({
      where: { status: { in: ['accepted', 'expired'] }, createdAt: { lt: cutoff(7) } },
    });
    expect(prismaMock.job.deleteMany).toHaveBeenCalledWith({
      where: { status: { in: ['completed', 'failed'] }, updatedAt: { lt: cutoff(45) } },
    });
    expect(prismaMock.emailMessage.deleteMany).toHaveBeenCalledWith({
      where: { status: 'sent', sentAt: { lt: cutoff(120) } },
    });
  });

  it('accepts a 0-day override (purge as soon as eligible)', async () => {
    process.env.RETENTION_VERIFICATION_TOKEN_GRACE_DAYS = '0';
    await runRetentionPurge(NOW);
    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expires: { lt: cutoff(0) } },
    });
  });

  it('falls back to the default for a non-numeric or negative override', async () => {
    process.env.RETENTION_JOB_DAYS = 'not-a-number';
    process.env.RETENTION_INVITE_DAYS = '-5';
    await runRetentionPurge(NOW);
    expect(prismaMock.job.deleteMany).toHaveBeenCalledWith({
      where: { status: { in: ['completed', 'failed'] }, updatedAt: { lt: cutoff(90) } },
    });
    expect(prismaMock.invite.deleteMany).toHaveBeenCalledWith({
      where: { status: { in: ['accepted', 'expired'] }, createdAt: { lt: cutoff(30) } },
    });
  });
});

// ─── Audit-log safety ─────────────────────────────────────────────────────────

describe('runRetentionPurge — audit logs are never purged', () => {
  it('never calls a deleteMany on the audit_logs table', async () => {
    await runRetentionPurge(NOW);
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});

// ─── Best-effort behavior ─────────────────────────────────────────────────────

describe('runRetentionPurge — best-effort isolation', () => {
  it('returns the deleted count from each successful purge', async () => {
    const summary = await runRetentionPurge(NOW);
    expect(summary).toEqual({
      verificationTokens: 1,
      invites: 2,
      jobs: 3,
      emailMessages: 4,
    });
  });

  it('swallows a failing purge, logs it, reports 0, and still runs the others', async () => {
    prismaMock.job.deleteMany.mockRejectedValue(new Error('db down'));

    const summary = await runRetentionPurge(NOW);

    expect(summary.jobs).toBe(0);
    // The other purges are unaffected.
    expect(summary.verificationTokens).toBe(1);
    expect(summary.invites).toBe(2);
    expect(summary.emailMessages).toBe(4);
    expect(prismaMock.emailMessage.deleteMany).toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('Failed to purge jobs') }),
    );
  });

  it('never throws even when every purge fails', async () => {
    const boom = new Error('db down');
    prismaMock.verificationToken.deleteMany.mockRejectedValue(boom);
    prismaMock.invite.deleteMany.mockRejectedValue(boom);
    prismaMock.job.deleteMany.mockRejectedValue(boom);
    prismaMock.emailMessage.deleteMany.mockRejectedValue(boom);

    const summary = await runRetentionPurge(NOW);

    expect(summary).toEqual({
      verificationTokens: 0,
      invites: 0,
      jobs: 0,
      emailMessages: 0,
    });
  });
});
