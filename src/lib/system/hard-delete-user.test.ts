// @vitest-environment node
/**
 * `hardDeleteUser` / `previewUserHardDelete` — the /system permanent user delete.
 *
 * No real-Postgres vitest harness exists, so the database is a hand-rolled fake
 * that records every call in one ordered log shared with the transaction wrapper,
 * the lock, the audit write and the post-commit storage cleanup. The ordering,
 * the refusals and "nothing was written" are asserted against that log; the real
 * cascade is proven by tests/e2e/system-user-hard-delete.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const order: string[] = [];
  const state = {
    user: null as null | {
      id: string;
      email: string;
      deletedAt: Date | null;
      avatarUrl?: string | null;
      fullName?: string;
    },
    userInTx: undefined as undefined | null | Record<string, unknown>,
    memberships: [] as { id: string; organizationId: string; role?: string; org?: unknown }[],
    systemMemberships: 0,
    // [pre-check, in-transaction] — each read pops the next value, then repeats the last.
    courses: [0] as number[],
    documents: [0] as number[],
    runningJobs: [0] as number[],
    certificates: [] as { pdfStoragePath: string | null }[],
    counts: {
      enrollment: 4,
      quizAttempt: 9,
      certificate: 3,
      notification: 6,
      invite: 2,
      emailMessage: 5,
      notificationEvent: 7,
      job: 1,
      mfaFactor: 1,
      mfaRecoveryCode: 10,
      verificationToken: 1,
    } as Record<string, number>,
    directReports: 0,
    txError: null as unknown,
  };
  return {
    order,
    state,
    mockAuditCritical: vi.fn(async () => {
      order.push('auditCritical');
    }),
    mockAudit: vi.fn(async () => undefined),
    mockInvalidate: vi.fn(async () => {
      order.push('invalidate');
    }),
    mockLock: vi.fn(async (_tx: unknown, ids: readonly string[]) => {
      order.push(`lock:${[...ids].join(',')}`);
    }),
    mockDeleteStorageObjects: vi.fn(),
    mockDeleteAvatarFolder: vi.fn(),
    mockIsOwnAvatarUri: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockTransaction: vi.fn(),
    writes: [] as { model: string; method: string; args: unknown }[],
  };
});

function pop(seq: number[]): number {
  return seq.length > 1 ? (seq.shift() as number) : seq[0];
}

function write(model: string, method: string) {
  return vi.fn(async (args: unknown) => {
    h.order.push(`${model}.${method}`);
    h.writes.push({ model, method, args });
    return { count: 1 };
  });
}

function buildClient() {
  const counter = (key: string) => vi.fn(async () => h.state.counts[key] ?? 0);
  return {
    user: {
      findUnique: vi.fn(async (args: { select?: Record<string, boolean> }) => {
        if (args.select?.avatarUrl) {
          if (h.state.userInTx !== undefined) return h.state.userInTx;
        }
        return h.state.user ? { ...h.state.user } : null;
      }),
      delete: write('user', 'delete'),
    },
    organizationUser: {
      findMany: vi.fn<() => Promise<unknown[]>>(async () => h.state.memberships),
      count: vi.fn(async (args: { where: { userId?: string; managerId?: unknown } }) =>
        args.where.managerId ? h.state.directReports : h.state.systemMemberships,
      ),
      deleteMany: write('organizationUser', 'deleteMany'),
    },
    course: { count: vi.fn(async () => pop(h.state.courses)) },
    document: { count: vi.fn(async () => pop(h.state.documents)) },
    job: {
      count: vi.fn(async (args: { where: { status?: unknown } }) =>
        args.where.status ? pop(h.state.runningJobs) : h.state.counts.job,
      ),
      deleteMany: write('job', 'deleteMany'),
    },
    enrollment: { count: counter('enrollment') },
    quizAttempt: { count: counter('quizAttempt') },
    certificate: {
      count: vi.fn(async () => h.state.counts.certificate),
      findMany: vi.fn(async () => h.state.certificates),
    },
    notification: { count: counter('notification') },
    invite: { count: counter('invite'), deleteMany: write('invite', 'deleteMany') },
    emailMessage: {
      count: counter('emailMessage'),
      deleteMany: write('emailMessage', 'deleteMany'),
    },
    notificationEvent: {
      count: counter('notificationEvent'),
      deleteMany: write('notificationEvent', 'deleteMany'),
    },
    mfaFactor: { count: counter('mfaFactor'), deleteMany: write('mfaFactor', 'deleteMany') },
    mfaRecoveryCode: {
      count: counter('mfaRecoveryCode'),
      deleteMany: write('mfaRecoveryCode', 'deleteMany'),
    },
    verificationToken: {
      count: counter('verificationToken'),
      deleteMany: write('verificationToken', 'deleteMany'),
    },
    $transaction: h.mockTransaction,
  };
}

vi.mock('@/db/index', () => ({
  prisma: {},
  get rawPrisma() {
    return client;
  },
}));
vi.mock('@/lib/audit', () => ({ audit: h.mockAudit, auditCritical: h.mockAuditCritical }));
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: h.mockInvalidate,
}));
vi.mock('@/lib/logger', () => ({ logger: h.mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/lib/organization/owner-guard', () => ({ lockOrganizations: h.mockLock }));
vi.mock('@/lib/storage/avatar', () => ({
  isOwnAvatarUri: h.mockIsOwnAvatarUri,
  deleteUserAvatarFolder: h.mockDeleteAvatarFolder,
}));
vi.mock('@/lib/storage/cleanup', () => ({ deleteStorageObjects: h.mockDeleteStorageObjects }));

import { Prisma } from '@/generated/prisma/client';
import { SYSTEM_ORG_SLUG, SYSTEM_USER_EMAIL } from '@/lib/video/system-user';
import {
  EMAIL_MISMATCH_REFUSAL,
  NOT_ACKNOWLEDGED_REFUSAL,
  NOT_SOFT_DELETED_REFUSAL,
  SYSTEM_USER_REFUSAL,
  authoredContentRefusal,
  hardDeleteUser,
  previewUserHardDelete,
  runningJobsRefusal,
} from './hard-delete-user';
import { HARD_DELETE_DISABLED_REFUSAL } from './hard-delete-flag';

let client: ReturnType<typeof buildClient>;

const USER_ID = '3f2b8c1e-5d4a-4e7b-9a10-0c2d3e4f5a6b';
const EMAIL = 'Dana.Departed@Acme.test';
const ACTOR = { actorRole: 'system_admin', ip: '203.0.113.9' };
const CONFIRM = { confirmEmail: EMAIL, acknowledged: true };
const DELETED_AT = new Date('2026-10-01T09:00:00Z');

const DEFAULT_COUNTS = { ...h.state.counts };

function resetState() {
  h.order.length = 0;
  h.writes.length = 0;
  Object.assign(h.state, {
    user: { id: USER_ID, email: EMAIL, deletedAt: DELETED_AT, avatarUrl: null, fullName: 'Dana' },
    userInTx: undefined,
    memberships: [
      { id: 'm-b', organizationId: 'org-b' },
      { id: 'm-a', organizationId: 'org-a' },
    ],
    systemMemberships: 0,
    courses: [0],
    documents: [0],
    runningJobs: [0],
    certificates: [],
    counts: { ...DEFAULT_COUNTS },
    directReports: 0,
    txError: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'true');
  resetState();
  client = buildClient();
  client.$transaction.mockImplementation(async (fn: (tx: typeof client) => Promise<unknown>) => {
    h.order.push('begin');
    const result = await fn(client);
    if (h.state.txError) throw h.state.txError;
    h.order.push('commit');
    return result;
  });
  h.mockIsOwnAvatarUri.mockReturnValue(true);
  h.mockDeleteStorageObjects.mockImplementation(async (uris: string[]) => {
    h.order.push('deleteStorageObjects');
    return { attempted: uris.length, failed: [] };
  });
  h.mockDeleteAvatarFolder.mockImplementation(async () => {
    h.order.push('deleteAvatarFolder');
    return { status: 'deleted', listed: 0, deleted: 0, failed: [] };
  });
});

const WRITE_ORDER = [
  'job.deleteMany',
  'emailMessage.deleteMany',
  'notificationEvent.deleteMany',
  'invite.deleteMany',
  'verificationToken.deleteMany',
  'organizationUser.deleteMany',
  'mfaFactor.deleteMany',
  'mfaRecoveryCode.deleteMany',
  'user.delete',
];

describe('hardDeleteUser — refusals return a value and write nothing', () => {
  function expectNothingWritten() {
    expect(h.writes).toEqual([]);
    expect(h.mockAuditCritical).not.toHaveBeenCalled();
    expect(h.mockInvalidate).not.toHaveBeenCalled();
    expect(h.mockDeleteStorageObjects).not.toHaveBeenCalled();
    expect(h.mockDeleteAvatarFolder).not.toHaveBeenCalled();
  }

  it('is disabled unless the flag is exactly true, and does not even read the user', async () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'TRUE');

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({ status: 'disabled' });

    expect(client.user.findUnique).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it('reports not_found for an unknown user', async () => {
    h.state.user = null;

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'not_found',
    });
    expectNothingWritten();
  });

  it('refuses a user who has not been soft-deleted', async () => {
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: null };

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'not_soft_deleted',
    });
    expect(client.$transaction).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each([
    ['a different address', 'someone.else@acme.test'],
    ['the wrong case', EMAIL.toLowerCase()],
    ['trailing whitespace', `${EMAIL} `],
    ['leading whitespace', ` ${EMAIL}`],
    ['empty', ''],
  ])('refuses a typed email that is %s (exact match only)', async (_label, typed) => {
    await expect(
      hardDeleteUser(USER_ID, { confirmEmail: typed, acknowledged: true }, ACTOR),
    ).resolves.toEqual({ status: 'confirmation_mismatch' });
    expect(client.$transaction).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it.each([false, undefined, 'true', 1] as unknown[])(
    'refuses when acknowledged is %j (only the boolean true passes)',
    async (value) => {
      await expect(
        hardDeleteUser(USER_ID, { confirmEmail: EMAIL, acknowledged: value as boolean }, ACTOR),
      ).resolves.toEqual({ status: 'not_acknowledged' });
      expect(client.$transaction).not.toHaveBeenCalled();
      expectNothingWritten();
    },
  );

  it('applies the refusals in the documented order', async () => {
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: null };
    await expect(
      hardDeleteUser(USER_ID, { confirmEmail: 'wrong', acknowledged: false }, ACTOR),
    ).resolves.toEqual({ status: 'not_soft_deleted' });

    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: DELETED_AT };
    await expect(
      hardDeleteUser(USER_ID, { confirmEmail: 'wrong', acknowledged: false }, ACTOR),
    ).resolves.toEqual({ status: 'confirmation_mismatch' });

    h.state.courses = [2];
    await expect(
      hardDeleteUser(USER_ID, { confirmEmail: EMAIL, acknowledged: false }, ACTOR),
    ).resolves.toEqual({ status: 'not_acknowledged' });
    expectNothingWritten();
  });

  describe('the System user', () => {
    it('is refused by its reserved email, in any case', async () => {
      h.state.user = {
        id: USER_ID,
        email: SYSTEM_USER_EMAIL.toUpperCase(),
        deletedAt: DELETED_AT,
      };

      await expect(
        hardDeleteUser(
          USER_ID,
          { confirmEmail: SYSTEM_USER_EMAIL.toUpperCase(), acknowledged: true },
          ACTOR,
        ),
      ).resolves.toEqual({ status: 'refused', message: SYSTEM_USER_REFUSAL });
      expectNothingWritten();
    });

    it('is refused by membership in the system organization, whatever its email', async () => {
      h.state.systemMemberships = 1;

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: SYSTEM_USER_REFUSAL,
      });
      expect(client.organizationUser.count).toHaveBeenCalledWith({
        where: { userId: USER_ID, organization: { slug: SYSTEM_ORG_SLUG } },
      });
      expectNothingWritten();
    });

    it('is re-checked inside the transaction when the membership appears after the pre-check', async () => {
      let call = 0;
      client.organizationUser.count.mockImplementation(async () => (call++ === 0 ? 0 : 1));

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: SYSTEM_USER_REFUSAL,
      });
      expect(h.order).toEqual(['begin', 'lock:org-b,org-a', 'commit']);
      expectNothingWritten();
    });
  });

  describe('authored content', () => {
    it('refuses a course author, naming the counts, and counts through the raw client', async () => {
      h.state.courses = [2];
      h.state.documents = [5];

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message:
          'This user authored 2 course(s) and uploaded 5 document(s). Delete the organization instead; content is never reassigned.',
      });
      expect(client.course.count).toHaveBeenCalledWith({
        where: { createdByOrgUserId: { in: ['m-b', 'm-a'] } },
      });
      expect(client.document.count).toHaveBeenCalledWith({
        where: { organizationUserId: { in: ['m-b', 'm-a'] } },
      });
      expectNothingWritten();
    });

    it('refuses on documents alone', async () => {
      h.state.documents = [1];

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: authoredContentRefusal({ courses: 0, documents: 1 }),
      });
    });

    it('is re-checked inside the transaction when a course is authored after the pre-check', async () => {
      h.state.courses = [0, 3];

      const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

      expect(result).toEqual({
        status: 'refused',
        message: authoredContentRefusal({ courses: 3, documents: 0 }),
      });
      expect(h.order).toEqual(['begin', 'lock:org-b,org-a', 'commit']);
      expectNothingWritten();
    });
  });

  describe('running jobs', () => {
    it('refuses while a job is queued or processing, filtering on exactly those statuses', async () => {
      h.state.runningJobs = [2];

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: 'This user has 2 background job(s) still running. Try again once they finish.',
      });
      expect(client.job.count).toHaveBeenCalledWith({
        where: { userId: USER_ID, status: { in: ['queued', 'processing'] } },
      });
      expectNothingWritten();
    });

    it('is re-checked inside the transaction when a job starts after the pre-check', async () => {
      h.state.runningJobs = [0, 1];

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: runningJobsRefusal(1),
      });
      expect(h.order).toEqual(['begin', 'lock:org-b,org-a', 'commit']);
      expectNothingWritten();
    });

    it('does not refuse for finished jobs: they are deleted with the user', async () => {
      h.state.runningJobs = [0];
      h.state.counts.job = 4;

      const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

      expect(result).toMatchObject({ status: 'deleted', counts: { jobs: 4 } });
      expect(h.order).toContain('job.deleteMany');
    });

    it('reports the authored refusal before the running-jobs refusal', async () => {
      h.state.courses = [1];
      h.state.runningJobs = [3];

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'refused',
        message: authoredContentRefusal({ courses: 1, documents: 0 }),
      });
    });
  });

  describe('in-transaction re-checks of the request', () => {
    it('returns not_found when the user vanished before the transaction read', async () => {
      h.state.userInTx = null;

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'not_found',
      });
      expectNothingWritten();
    });

    it('returns not_soft_deleted when the user was restored after the pre-check', async () => {
      h.state.userInTx = { id: USER_ID, email: EMAIL, deletedAt: null, avatarUrl: null };

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'not_soft_deleted',
      });
      expectNothingWritten();
    });

    it('returns confirmation_mismatch when the email changed after the pre-check', async () => {
      h.state.userInTx = {
        id: USER_ID,
        email: 'renamed@acme.test',
        deletedAt: DELETED_AT,
        avatarUrl: null,
      };

      await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toEqual({
        status: 'confirmation_mismatch',
      });
      expectNothingWritten();
    });
  });
});

describe('hardDeleteUser — the delete', () => {
  it('runs the exact ordered sequence: lock, deletes, user last, audit, commit, then cleanup', async () => {
    h.state.certificates = [{ pdfStoragePath: 'gcs://b/certs/1.pdf' }];

    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.order).toEqual([
      'begin',
      'lock:org-b,org-a',
      ...WRITE_ORDER,
      'auditCritical',
      'commit',
      'invalidate',
      'deleteStorageObjects',
      'deleteAvatarFolder',
    ]);
  });

  it('uses the 30 second transaction timeout', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });
  });

  it('locks every organization the user belongs to, deleted ones included', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockLock).toHaveBeenCalledWith(expect.anything(), ['org-b', 'org-a']);
  });

  it('matches emails and verification tokens case-insensitively on the stored address', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    const insensitive = { equals: EMAIL, mode: 'insensitive' };
    const argsOf = (model: string) => h.writes.find((w) => w.model === model)?.args;
    expect(argsOf('emailMessage')).toEqual({ where: { toEmail: insensitive } });
    expect(argsOf('invite')).toEqual({ where: { email: insensitive } });
    expect(argsOf('verificationToken')).toEqual({ where: { identifier: insensitive } });
  });

  it('deletes notification events where the user is the actor OR the subject, by User id', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.writes.find((w) => w.model === 'notificationEvent')?.args).toEqual({
      where: { OR: [{ actorUserId: USER_ID }, { subjectUserId: USER_ID }] },
    });
  });

  it('deletes memberships, factors and recovery codes by user id, and the user by id', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    for (const model of ['organizationUser', 'mfaFactor', 'mfaRecoveryCode', 'job']) {
      expect(h.writes.find((w) => w.model === model)?.args).toEqual({ where: { userId: USER_ID } });
    }
    expect(h.writes.find((w) => w.model === 'user')?.args).toEqual({ where: { id: USER_ID } });
  });

  it('returns the counts it destroyed', async () => {
    const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(result).toEqual({
      status: 'deleted',
      counts: {
        memberships: 2,
        enrollments: 4,
        quizAttempts: 9,
        certificates: 3,
        notifications: 6,
        invites: 2,
        emailMessages: 5,
        notificationEvents: 7,
        jobs: 1,
        mfaFactors: 1,
        mfaRecoveryCodes: 10,
        verificationTokens: 1,
      },
      storage: { attempted: 0, failed: 0 },
    });
  });

  it('deletes a soft-deleted user whose only organization is itself soft-deleted', async () => {
    h.state.memberships = [{ id: 'm-a', organizationId: 'org-a', org: { deletedAt: DELETED_AT } }];

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toMatchObject({
      status: 'deleted',
    });
    expect(h.mockLock).toHaveBeenCalledWith(expect.anything(), ['org-a']);
  });

  it('deletes a user with no memberships at all', async () => {
    h.state.memberships = [];

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).resolves.toMatchObject({
      status: 'deleted',
      counts: { memberships: 0 },
    });
  });

  it('invalidates the revalidation cache for the deleted user', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockInvalidate).toHaveBeenCalledWith(USER_ID);
  });
});

describe('hardDeleteUser — the audit row', () => {
  it('is written by auditCritical inside the transaction with ids and counts only', async () => {
    h.state.certificates = [
      { pdfStoragePath: 'gcs://b/c1.pdf' },
      { pdfStoragePath: 'gcs://b/c2.pdf' },
    ];

    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockAuditCritical).toHaveBeenCalledTimes(1);
    const [entry, txClient] = h.mockAuditCritical.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(txClient).toBe(client);
    expect(entry).toEqual({
      action: 'system.user.hard_delete',
      targetType: 'user',
      targetId: USER_ID,
      metadata: {
        mode: 'hard',
        memberships: 2,
        enrollments: 4,
        quizAttempts: 9,
        certificates: 3,
        notifications: 6,
        invites: 2,
        emailMessages: 5,
        notificationEvents: 7,
        jobs: 1,
        mfaFactors: 1,
        mfaRecoveryCodes: 10,
        verificationTokens: 1,
        storageObjects: { certificatePdfs: 2, avatarFolder: true },
      },
      actorRole: 'system_admin',
      ip: '203.0.113.9',
    });
    expect(h.order.indexOf('auditCritical')).toBeLessThan(h.order.indexOf('commit'));
  });

  it('carries no email, name or organizationId anywhere in the row', async () => {
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: DELETED_AT, fullName: 'Dana Departed' };

    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    const [entry] = h.mockAuditCritical.mock.calls[0] as unknown as [Record<string, unknown>];
    const json = JSON.stringify(entry);
    expect(json).not.toContain(EMAIL);
    expect(json.toLowerCase()).not.toContain('acme');
    expect(json).not.toContain('Dana');
    expect(entry).not.toHaveProperty('organizationId');
    expect(entry.metadata).not.toHaveProperty('email');
    expect(entry.metadata).not.toHaveProperty('name');
    expect(entry.metadata).not.toHaveProperty('organizationId');
  });

  it('is not written when the delete is refused', async () => {
    h.state.courses = [1];
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockAuditCritical).not.toHaveBeenCalled();
  });
});

describe('hardDeleteUser — the foreign-key backstop', () => {
  function p2003() {
    return new Prisma.PrismaClientKnownRequestError('FK violation', {
      code: 'P2003',
      clientVersion: 'test',
    });
  }

  it('turns a P2003 from a course authored mid-delete into the authored refusal, never a throw', async () => {
    h.state.txError = p2003();
    h.state.courses = [0, 0, 2];

    const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(result).toEqual({
      status: 'refused',
      message: authoredContentRefusal({ courses: 2, documents: 0 }),
    });
    expect(h.order).not.toContain('commit');
    expect(h.mockInvalidate).not.toHaveBeenCalled();
    expect(h.mockDeleteStorageObjects).not.toHaveBeenCalled();
    expect(h.mockDeleteAvatarFolder).not.toHaveBeenCalled();
  });

  it('rethrows any other database error', async () => {
    h.state.txError = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).rejects.toThrow('unique');
    expect(h.mockInvalidate).not.toHaveBeenCalled();
    expect(h.mockDeleteStorageObjects).not.toHaveBeenCalled();
  });

  it('rethrows a non-Prisma error', async () => {
    h.state.txError = new Error('connection lost');

    await expect(hardDeleteUser(USER_ID, CONFIRM, ACTOR)).rejects.toThrow('connection lost');
  });
});

describe('hardDeleteUser — post-commit storage cleanup', () => {
  it('deletes certificate PDFs and the own avatar by exact URI, skipping null paths', async () => {
    h.state.user = {
      id: USER_ID,
      email: EMAIL,
      deletedAt: DELETED_AT,
      avatarUrl: `gcs://b/avatars/${USER_ID}/1-me.png`,
    };
    h.state.certificates = [
      { pdfStoragePath: 'gcs://b/certs/1.pdf' },
      { pdfStoragePath: null },
      { pdfStoragePath: 'gcs://b/certs/2.pdf' },
    ];

    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockDeleteStorageObjects).toHaveBeenCalledWith(
      ['gcs://b/certs/1.pdf', 'gcs://b/certs/2.pdf', `gcs://b/avatars/${USER_ID}/1-me.png`],
      { module: '[system]', ids: { userId: USER_ID } },
    );
    expect(h.mockDeleteAvatarFolder).toHaveBeenCalledWith(USER_ID);
  });

  it('selects certificates only for the user’s own memberships', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(client.certificate.findMany).toHaveBeenCalledWith({
      where: { organizationUserId: { in: ['m-b', 'm-a'] }, pdfStoragePath: { not: null } },
      select: { pdfStoragePath: true },
    });
  });

  it('does not delete an avatarUrl that fails the own-avatar guard', async () => {
    h.state.user = {
      id: USER_ID,
      email: EMAIL,
      deletedAt: DELETED_AT,
      avatarUrl: 'gcs://b/documents/other-tenant/secret.pdf',
    };
    h.mockIsOwnAvatarUri.mockReturnValue(false);

    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockIsOwnAvatarUri).toHaveBeenCalledWith(
      'gcs://b/documents/other-tenant/secret.pdf',
      USER_ID,
    );
    expect(h.mockDeleteStorageObjects).toHaveBeenCalledWith([], expect.anything());
  });

  it('does not consult the guard for a null avatarUrl', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(h.mockIsOwnAvatarUri).not.toHaveBeenCalled();
    expect(h.mockDeleteStorageObjects).toHaveBeenCalledWith([], expect.anything());
  });

  it('writes no storage_incomplete audit when everything was removed', async () => {
    h.mockDeleteAvatarFolder.mockResolvedValue({
      status: 'deleted',
      listed: 2,
      deleted: 2,
      failed: [],
    });

    const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(result).toMatchObject({ storage: { attempted: 2, failed: 0 } });
    expect(h.mockAudit).not.toHaveBeenCalled();
  });

  it('keeps the delete and records failed exact URIs and failed folder objects for retry', async () => {
    h.mockDeleteStorageObjects.mockResolvedValue({
      attempted: 3,
      failed: ['gcs://b/certs/1.pdf'],
    });
    h.mockDeleteAvatarFolder.mockResolvedValue({
      status: 'deleted',
      listed: 2,
      deleted: 1,
      failed: [`gcs://b/avatars/${USER_ID}/old.png`],
    });

    const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    expect(result).toMatchObject({
      status: 'deleted',
      storage: { attempted: 5, failed: 2 },
    });
    expect(h.mockAudit).toHaveBeenCalledWith({
      action: 'system.user.hard_delete.storage_incomplete',
      targetType: 'user',
      targetId: USER_ID,
      metadata: {
        failedUris: ['gcs://b/certs/1.pdf', `gcs://b/avatars/${USER_ID}/old.png`],
        avatarFolderRefusal: null,
      },
      actorRole: 'system_admin',
      ip: '203.0.113.9',
    });
  });

  it.each(['list_failed', 'over_cap', 'invalid_user_id'] as const)(
    'counts a refused avatar folder (%s) as one storage failure and records the reason',
    async (reason) => {
      h.mockDeleteAvatarFolder.mockResolvedValue({ status: 'refused', reason, listed: 0 });

      const result = await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

      expect(result).toMatchObject({ status: 'deleted', storage: { failed: 1 } });
      expect(h.mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'system.user.hard_delete.storage_incomplete',
          metadata: { failedUris: [], avatarFolderRefusal: reason },
        }),
      );
    },
  );

  it('logs the hard delete with ids and counts, never the email', async () => {
    await hardDeleteUser(USER_ID, CONFIRM, ACTOR);

    const entry = h.mockLogger.info.mock.calls
      .map(([line]) => line)
      .find((line) => line.msg === '[system] User hard-deleted');
    expect(entry).toMatchObject({ userId: USER_ID, memberships: 2, certificates: 3 });
    expect(JSON.stringify(entry)).not.toContain(EMAIL);
  });
});

describe('previewUserHardDelete', () => {
  beforeEach(() => {
    h.state.memberships = [
      { id: 'm-a', organizationId: 'org-a', role: 'owner', org: { name: 'Acme', deletedAt: null } },
      {
        id: 'm-b',
        organizationId: 'org-b',
        role: 'worker',
        org: { name: 'Beta', deletedAt: DELETED_AT },
      },
    ];
    client.organizationUser.findMany.mockImplementation(async () =>
      h.state.memberships.map((m) => ({
        id: m.id,
        role: m.role,
        organization: m.org,
      })),
    );
    h.state.certificates = [];
  });

  it('returns null for an unknown user', async () => {
    h.state.user = null;

    await expect(previewUserHardDelete(USER_ID)).resolves.toBeNull();
  });

  it('reports the counts, organizations, direct reports and certificate PDFs', async () => {
    h.state.directReports = 3;

    const preview = await previewUserHardDelete(USER_ID);

    expect(preview).toMatchObject({
      enabled: true,
      refusal: null,
      user: { id: USER_ID, email: EMAIL, name: 'Dana', deletedAt: DELETED_AT },
      authored: { courses: 0, documents: 0 },
      destroyed: { memberships: 2, enrollments: 4, certificates: 3, emailMessages: 5 },
      storageObjects: { avatarFolder: true, certificatePdfs: 3 },
      directReports: 3,
      organizations: [
        { name: 'Acme', deleted: false, wasOwner: true },
        { name: 'Beta', deleted: true, wasOwner: false },
      ],
    });
  });

  it('shows zero counts rather than omitting them', async () => {
    for (const key of Object.keys(h.state.counts)) h.state.counts[key] = 0;

    const preview = await previewUserHardDelete(USER_ID);

    expect(Object.values(preview!.destroyed).filter((n) => n !== 2)).toEqual(
      Array(Object.keys(preview!.destroyed).length - 1).fill(0),
    );
  });

  it('falls back to the email local part when the user has no name', async () => {
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: DELETED_AT, fullName: '' };

    const preview = await previewUserHardDelete(USER_ID);

    expect(preview?.user.name).toBe('Dana.Departed');
  });

  it('refuses with the flag message first when permanent deletion is disabled', async () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'false');
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: null };
    h.state.courses = [4];

    const preview = await previewUserHardDelete(USER_ID);

    expect(preview).toMatchObject({ enabled: false, refusal: HARD_DELETE_DISABLED_REFUSAL });
  });

  it('refuses a user who is not soft-deleted', async () => {
    h.state.user = { id: USER_ID, email: EMAIL, deletedAt: null };

    const preview = await previewUserHardDelete(USER_ID);

    expect(preview?.refusal).toBe(NOT_SOFT_DELETED_REFUSAL);
  });

  it('counts archived authored content through the raw client and refuses', async () => {
    h.state.courses = [2];
    h.state.documents = [1];

    const preview = await previewUserHardDelete(USER_ID);

    expect(preview).toMatchObject({
      authored: { courses: 2, documents: 1 },
      refusal: authoredContentRefusal({ courses: 2, documents: 1 }),
    });
  });

  it('refuses the System user', async () => {
    h.state.systemMemberships = 1;

    expect((await previewUserHardDelete(USER_ID))?.refusal).toBe(SYSTEM_USER_REFUSAL);
  });

  it('refuses while jobs are running', async () => {
    h.state.runningJobs = [2];

    expect((await previewUserHardDelete(USER_ID))?.refusal).toBe(runningJobsRefusal(2));
  });

  it('never writes anything', async () => {
    await previewUserHardDelete(USER_ID);

    expect(h.writes).toEqual([]);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe('refusal message exports', () => {
  it('match the approved copy exactly', () => {
    expect(NOT_SOFT_DELETED_REFUSAL).toBe(
      'Delete this user first. A user must be deleted before it can be permanently deleted.',
    );
    expect(EMAIL_MISMATCH_REFUSAL).toBe('The email you typed does not match.');
    expect(NOT_ACKNOWLEDGED_REFUSAL).toBe(
      'Confirm that you understand certificates will be destroyed.',
    );
    expect(SYSTEM_USER_REFUSAL).toBe('The internal System user cannot be deleted.');
  });
});
