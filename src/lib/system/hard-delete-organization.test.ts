// @vitest-environment node
/**
 * `hardDeleteOrganization` / `previewOrganizationHardDelete` — the /system
 * permanent organization delete.
 *
 * No real-Postgres vitest harness exists, so the database is a fake client that
 * answers any `model.method` call and records it in one ordered log shared with
 * the transaction wrapper, the lock, the Stripe cancel, the audit write and the
 * post-commit storage cleanup. Ordering, refusals and "nothing was written" are
 * asserted against that log; the real cascade is proven by the e2e spec.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Responder = (args: Record<string, unknown>, scope: 'raw' | 'tx') => unknown;

const h = vi.hoisted(() => {
  const order: string[] = [];
  const calls: { scope: string; model: string; method: string; args: Record<string, unknown> }[] =
    [];
  const state = {
    organization: null as null | Record<string, unknown>,
    organizationInTx: undefined as undefined | null | Record<string, unknown>,
    responses: {} as Record<string, Responder>,
    txError: null as unknown,
    txOptions: null as unknown,
  };
  return {
    order,
    calls,
    state,
    mockAuditCritical: vi.fn(async () => {
      order.push('auditCritical');
    }),
    mockAudit: vi.fn(async () => undefined),
    mockLock: vi.fn(async (_tx: unknown, ids: readonly string[]) => {
      order.push(`lock:${[...ids].join(',')}`);
    }),
    mockDeleteStorageObjects: vi.fn(),
    mockCancel: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

const WRITE_METHODS = new Set(['delete', 'deleteMany', 'update', 'updateMany', 'create']);

function makeClient(scope: 'raw' | 'tx'): unknown {
  return new Proxy(
    {},
    {
      get(_target, model: string) {
        if (model === '$transaction') return transaction;
        return new Proxy(
          {},
          {
            get(_inner, method: string) {
              return async (args: Record<string, unknown> = {}) => {
                h.calls.push({ scope, model, method, args });
                if (WRITE_METHODS.has(method)) h.order.push(`${model}.${method}`);
                const responder = h.state.responses[`${model}.${method}`];
                if (responder) return responder(args, scope);
                if (model === 'organization' && method === 'findUnique') {
                  if (scope === 'tx' && h.state.organizationInTx !== undefined) {
                    return h.state.organizationInTx;
                  }
                  return h.state.organization;
                }
                if (method === 'count') return 0;
                if (method === 'findMany') return [];
                if (method === 'deleteMany' || method === 'updateMany') return { count: 1 };
                return {};
              };
            },
          },
        );
      },
    },
  );
}

async function transaction(fn: (tx: unknown) => Promise<unknown>, options: unknown) {
  h.order.push('tx:begin');
  h.state.txOptions = options;
  const result = await fn(makeClient('tx'));
  if (h.state.txError) throw h.state.txError;
  h.order.push('tx:commit');
  return result;
}

vi.mock('@/db/index', () => ({
  prisma: {},
  get rawPrisma() {
    return makeClient('raw');
  },
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ audit: h.mockAudit, auditCritical: h.mockAuditCritical }));
vi.mock('@/lib/logger', () => ({ logger: h.mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/lib/organization/owner-guard', () => ({ lockOrganizations: h.mockLock }));
vi.mock('@/lib/storage/cleanup', () => ({ deleteStorageObjects: h.mockDeleteStorageObjects }));
vi.mock('@/lib/system/cancel-subscription-now', () => ({
  cancelStripeSubscriptionNow: h.mockCancel,
}));

import { Prisma } from '@/generated/prisma/client';
import { SYSTEM_ORG_SLUG } from '@/lib/video/system-user';
import { SYSTEM_ORGANIZATION_REFUSAL } from './delete-organization';
import { HARD_DELETE_DISABLED_REFUSAL } from './hard-delete-flag';
import {
  DELETE_FAILED_AFTER_CANCEL_REFUSAL,
  HARD_DELETE_ORDER,
  NOT_SOFT_DELETED_ORGANIZATION_REFUSAL,
  STILL_REFERENCED_REFUSAL,
  STRIPE_CANCEL_FAILED_REFUSAL,
  crossOrganizationUsageRefusal,
  globalCoursesRefusal,
  hardDeleteOrganization,
  previewOrganizationHardDelete,
  runningWorkRefusal,
} from './hard-delete-organization';

const ORG_ID = 'org-1';
const ORG_NAME = 'Acme Behavioral Health';
const ACTOR = { actorRole: 'system_admin', ip: '203.0.113.9' };
const CONFIRM = {
  confirmName: ORG_NAME,
  confirmWord: 'DELETE',
  acknowledged: true,
  cancelSubscription: false,
};
const DELETED_AT = new Date('2026-10-01T09:00:00Z');
const BUCKET = 'gcs://bucket';

function organization(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: ORG_NAME,
    slug: 'acme',
    deletedAt: DELETED_AT,
    stripeCustomerId: 'cus_123',
    subscription: {
      plan: 'growth',
      status: 'active',
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_123',
    },
    ...overrides,
  };
}

function writes(scope = 'tx') {
  return h.calls.filter((c) => c.scope === scope && WRITE_METHODS.has(c.method));
}

function isCrossOrgQuery(args: Record<string, unknown>): boolean {
  return JSON.stringify(args).includes('"not":"org-1"');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'true');
  h.order.length = 0;
  h.calls.length = 0;
  Object.assign(h.state, {
    organization: organization(),
    organizationInTx: undefined,
    responses: {},
    txError: null,
    txOptions: null,
  });
  h.mockDeleteStorageObjects.mockImplementation(async (uris: string[]) => {
    h.order.push('deleteStorageObjects');
    return { attempted: uris.length, failed: [] };
  });
  h.mockCancel.mockImplementation(async () => {
    h.order.push('stripe.cancel');
    return 'cancelled';
  });
});

describe('request refusals', () => {
  it('does nothing at all while the flag is off', async () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'false');

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'disabled',
    });
    expect(h.calls).toEqual([]);
  });

  it('returns not_found for an unknown organization', async () => {
    h.state.organization = null;

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('refuses an organization that is not soft-deleted', async () => {
    h.state.organization = organization({ deletedAt: null });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'not_soft_deleted',
    });
    expect(h.order).toEqual([]);
  });

  it.each([
    ['a different case', { confirmName: ORG_NAME.toLowerCase() }],
    ['trailing whitespace', { confirmName: `${ORG_NAME} ` }],
    ['a lowercase word', { confirmWord: 'delete' }],
    ['a missing word', { confirmWord: '' }],
  ])('refuses a confirmation with %s', async (_label, override) => {
    await expect(
      hardDeleteOrganization(ORG_ID, { ...CONFIRM, ...override }, ACTOR),
    ).resolves.toEqual({ status: 'confirmation_mismatch' });
    expect(h.order).toEqual([]);
  });

  it('refuses without the acknowledgement', async () => {
    await expect(
      hardDeleteOrganization(ORG_ID, { ...CONFIRM, acknowledged: false }, ACTOR),
    ).resolves.toEqual({ status: 'not_acknowledged' });
    expect(h.order).toEqual([]);
  });
});

describe('data refusals (pre-check, nothing written)', () => {
  async function expectRefused(message: string) {
    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);
    expect(result).toEqual({ status: 'refused', message, subscriptionCancelled: false });
    expect(h.order).toEqual([]);
    expect(h.mockCancel).not.toHaveBeenCalled();
  }

  it('refuses the internal System organization', async () => {
    h.state.organization = organization({ slug: SYSTEM_ORG_SLUG });
    await expectRefused(SYSTEM_ORGANIZATION_REFUSAL);
  });

  it('refuses an organization that owns global courses, counted through the unfiltered client', async () => {
    h.state.responses['course.count'] = (args) =>
      (args.where as Record<string, unknown>).isGlobal ? 2 : 0;

    await expectRefused(globalCoursesRefusal(2));
    const globalCount = h.calls.find(
      (c) => c.model === 'course' && (c.args.where as Record<string, unknown>)?.isGlobal,
    );
    expect(globalCount?.args).toEqual({ where: { organizationId: ORG_ID, isGlobal: true } });
  });

  it.each([
    ['enrollment', 'enrollments', '3 enrollment(s)'],
    ['orgCourseOffering', 'offerings', '3 offering(s)'],
    ['certificate', 'certificates', '3 certificate(s)'],
    ['quizAttempt', 'quizAttempts', '3 quiz attempt(s)'],
    ['courseAssignment', 'courseAssignments', '3 course assignment(s)'],
    ['inviteCourseAssignment', 'inviteCourseAssignments', '3 invite course assignment(s)'],
    ['courseVersion', 'courseVersions', '3 course version(s) built from its documents'],
    ['course', 'authoredCourses', '3 course(s) authored by its members'],
    ['document', 'uploadedDocuments', '3 document(s) uploaded by its members'],
    ['organizationUserFacility', 'facilityLinks', '3 facility link(s)'],
    ['invite', 'facilityLinks', '3 facility link(s)'],
  ])('refuses when another organization depends on it via %s', async (model, _key, clause) => {
    h.state.responses[`${model}.count`] = (args) => (isCrossOrgQuery(args) ? 3 : 0);

    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(result.status).toBe('refused');
    expect(result.status === 'refused' && result.message).toContain(`(${clause})`);
    expect(h.order).toEqual([]);
  });

  it('lists every non-zero cross-organization clause in one message', () => {
    expect(
      crossOrganizationUsageRefusal({
        enrollments: 2,
        offerings: 1,
        certificates: 0,
        quizAttempts: 0,
        courseAssignments: 4,
        inviteCourseAssignments: 0,
        courseVersions: 0,
        authoredCourses: 0,
        uploadedDocuments: 0,
        facilityLinks: 0,
      }),
    ).toBe(
      "Other organizations use this organization's courses or data (2 enrollment(s), 1 offering(s), 4 course assignment(s)). Permanently deleting would destroy their records, so it is refused.",
    );
  });

  it('refuses while a member’s job is queued or processing', async () => {
    h.state.responses['organizationUser.findMany'] = () => [{ userId: 'u-1' }, { userId: 'u-2' }];
    h.state.responses['job.count'] = (args) =>
      (args.where as Record<string, unknown>).status ? 1 : 0;

    await expectRefused(runningWorkRefusal(1));
    const running = h.calls.find(
      (c) => c.model === 'job' && (c.args.where as Record<string, unknown>).status,
    );
    expect(running?.args).toEqual({
      where: {
        status: { in: ['queued', 'processing'] },
        OR: [
          { userId: { in: ['u-1', 'u-2'] } },
          { payload: { path: ['organizationId'], equals: ORG_ID } },
        ],
      },
    });
  });

  it('refuses while a lesson video or a preview video is still encoding', async () => {
    h.state.responses['lesson.count'] = (args) =>
      (args.where as Record<string, unknown>).mediaStatus ? 1 : 0;
    h.state.responses['course.count'] = (args) =>
      (args.where as Record<string, unknown>).previewMediaStatus ? 1 : 0;

    await expectRefused(runningWorkRefusal(2));
  });
});

describe('the transaction', () => {
  it('runs the deletes in the safe order, under the lock, then cleans storage after commit', async () => {
    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(result.status).toBe('deleted');
    expect(h.order).toEqual([
      'tx:begin',
      `lock:${ORG_ID}`,
      'user.updateMany',
      'notificationEvent.deleteMany',
      'emailMessage.deleteMany',
      'cycleSummaryRun.deleteMany',
      'job.deleteMany',
      'enrollment.deleteMany',
      'course.deleteMany',
      'document.deleteMany',
      'organizationUser.deleteMany',
      'invite.deleteMany',
      'facility.deleteMany',
      'organization.delete',
      'auditCritical',
      'tx:commit',
      'deleteStorageObjects',
    ]);
    expect(HARD_DELETE_ORDER).toEqual([
      'NotificationEvent',
      'EmailMessage',
      'CycleSummaryRun',
      'Job',
      'Enrollment',
      'Course',
      'Document',
      'OrganizationUser',
      'Invite',
      'Facility',
      'Organization',
    ]);
  });

  it('scopes every write to this organization and never deletes a User row', async () => {
    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    const byModel = Object.fromEntries(writes().map((w) => [`${w.model}.${w.method}`, w.args]));
    expect(byModel['user.updateMany']).toEqual({
      where: { lastActiveOrganizationId: ORG_ID },
      data: { lastActiveOrganizationId: null },
    });
    expect(byModel['enrollment.deleteMany']).toEqual({
      where: { organizationUser: { organizationId: ORG_ID } },
    });
    expect(byModel['organizationUser.deleteMany']).toEqual({ where: { organizationId: ORG_ID } });
    expect(byModel['course.deleteMany']).toEqual({ where: { organizationId: ORG_ID } });
    expect(byModel['document.deleteMany']).toEqual({ where: { organizationId: ORG_ID } });
    expect(byModel['job.deleteMany']).toEqual({
      where: { payload: { path: ['organizationId'], equals: ORG_ID } },
    });
    expect(byModel['organization.delete']).toEqual({ where: { id: ORG_ID } });
    expect(writes().filter((w) => w.model === 'user' && w.method !== 'updateMany')).toEqual([]);
    expect(writes('raw')).toEqual([]);
  });

  it('logs ids and counts only: no organization name, slug or Stripe id on any log line', async () => {
    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);
    h.state.responses['course.count'] = () => 2;
    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    const logged = JSON.stringify([
      h.mockLogger.info.mock.calls,
      h.mockLogger.warn.mock.calls,
      h.mockLogger.error.mock.calls,
    ]);
    expect(h.mockLogger.info).toHaveBeenCalled();
    expect(h.mockLogger.warn).toHaveBeenCalled();
    expect(logged).not.toContain(ORG_NAME);
    expect(logged).not.toContain('acme');
    expect(logged).not.toContain('cus_123');
    expect(logged).not.toContain('sub_123');
  });

  it('gives the transaction a 120 s timeout', async () => {
    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);
    expect(h.state.txOptions).toEqual({ timeout: 120_000 });
  });

  it('audits inside the transaction with ids, counts and Stripe ids only', async () => {
    h.state.responses['enrollment.count'] = (args) => (isCrossOrgQuery(args) ? 0 : 7);

    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(h.mockAuditCritical).toHaveBeenCalledTimes(1);
    const [entry, client] = h.mockAuditCritical.mock.calls[0] as unknown as [
      Record<string, unknown>,
      unknown,
    ];
    expect(client).toBeDefined();
    expect(entry).toMatchObject({
      action: 'system.org.hard_delete',
      targetType: 'organization',
      targetId: ORG_ID,
      organizationId: ORG_ID,
      ...ACTOR,
      metadata: {
        mode: 'hard',
        enrollments: 7,
        subscription: {
          cancelRequested: false,
          outcome: 'not_requested',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
        },
      },
    });
    expect(JSON.stringify(entry)).not.toContain(ORG_NAME);
  });

  it('re-checks under the lock: a restore that raced the pre-check refuses without deleting', async () => {
    h.state.organizationInTx = organization({ deletedAt: null });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'not_soft_deleted',
    });
    expect(writes()).toEqual([]);
    expect(h.mockAuditCritical).not.toHaveBeenCalled();
    expect(h.mockDeleteStorageObjects).not.toHaveBeenCalled();
  });

  it('re-checks under the lock: a cross-organization use that appeared since refuses', async () => {
    h.state.responses['orgCourseOffering.count'] = (args, scope) =>
      scope === 'tx' && isCrossOrgQuery(args) ? 1 : 0;

    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(result).toMatchObject({ status: 'refused', subscriptionCancelled: false });
    expect(writes()).toEqual([]);
  });

  it('returns a refusal value when a foreign key still blocks the delete', async () => {
    h.state.txError = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: 'test',
    });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).resolves.toEqual({
      status: 'refused',
      message: STILL_REFERENCED_REFUSAL,
      subscriptionCancelled: false,
    });
    expect(h.mockDeleteStorageObjects).not.toHaveBeenCalled();
  });

  it('rethrows any other failure when Stripe was not touched', async () => {
    h.state.txError = new Error('connection reset');

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR)).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('stored files', () => {
  function storageResponses(stillReferenced: string[] = []) {
    const rowsFor: Record<string, Record<string, string | null>[]> = {
      lesson: [
        { videoStorageUri: `${BUCKET}/videos/a.mp4`, videoPosterStorageUri: null },
        { videoStorageUri: `${BUCKET}/videos/a.mp4`, videoPosterStorageUri: `${BUCKET}/p.jpg` },
      ],
      course: [
        {
          previewVideoStorageUri: `${BUCKET}/preview.mp4`,
          previewPosterStorageUri: null,
          thumbnailStorageUri: `${BUCKET}/thumb.png`,
        },
      ],
      courseArtifact: [{ storageUri: `${BUCKET}/artifact.json` }],
      documentVersion: [{ storagePath: `${BUCKET}/documents/policy.pdf` }],
      certificate: [{ pdfStoragePath: `${BUCKET}/certificates/c1.pdf` }],
      facility: [
        { complianceDocumentUrl: `${BUCKET}/organizations/${ORG_ID}/compliance/1-a.pdf` },
        { complianceDocumentUrl: `${BUCKET}/organizations/other-org/compliance/1-b.pdf` },
      ],
      facilityDocument: [
        { url: `${BUCKET}/onboarding/u-1/1-c.pdf`, uploadedById: 'u-1' },
        { url: `${BUCKET}/onboarding/u-9/1-d.pdf`, uploadedById: 'u-1' },
        { url: 'not-a-storage-uri', uploadedById: 'u-1' },
      ],
    };
    for (const model of Object.keys(rowsFor).concat(['user', 'standardManual'])) {
      h.state.responses[`${model}.findMany`] = (args) => {
        const where = args.where as Record<string, unknown>;
        if (where.OR) {
          const columns = Object.keys(args.select as object);
          return stillReferenced.map((uri) => ({ [columns[0]]: uri }));
        }
        return rowsFor[model] ?? [];
      };
    }
  }

  it('collects every column, deduped, nulls and foreign or unparseable URIs skipped', async () => {
    storageResponses();

    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(h.mockDeleteStorageObjects).toHaveBeenCalledTimes(1);
    const [uris, context] = h.mockDeleteStorageObjects.mock.calls[0];
    expect([...uris].sort()).toEqual(
      [
        `${BUCKET}/videos/a.mp4`,
        `${BUCKET}/p.jpg`,
        `${BUCKET}/preview.mp4`,
        `${BUCKET}/thumb.png`,
        `${BUCKET}/artifact.json`,
        `${BUCKET}/documents/policy.pdf`,
        `${BUCKET}/certificates/c1.pdf`,
        `${BUCKET}/organizations/${ORG_ID}/compliance/1-a.pdf`,
        `${BUCKET}/onboarding/u-1/1-c.pdf`,
      ].sort(),
    );
    expect(context).toEqual({ module: '[system]', ids: { orgId: ORG_ID } });
    expect(result).toMatchObject({ status: 'deleted', storage: { attempted: 9, failed: 0 } });
  });

  it('keeps a URI that a surviving row elsewhere still references', async () => {
    storageResponses([`${BUCKET}/videos/a.mp4`]);

    await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    const [uris] = h.mockDeleteStorageObjects.mock.calls[0];
    expect(uris).not.toContain(`${BUCKET}/videos/a.mp4`);
    expect(uris).toContain(`${BUCKET}/preview.mp4`);
    const guardModels = h.calls
      .filter((c) => c.method === 'findMany' && (c.args.where as Record<string, unknown>)?.OR)
      .map((c) => c.model);
    expect(guardModels).toEqual(
      expect.arrayContaining(['lesson', 'course', 'certificate', 'user', 'standardManual']),
    );
  });

  it('records failed deletes for retry without undoing the delete', async () => {
    storageResponses();
    h.mockDeleteStorageObjects.mockResolvedValue({
      attempted: 9,
      failed: [`${BUCKET}/thumb.png`],
    });

    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(result).toMatchObject({ status: 'deleted', storage: { attempted: 9, failed: 1 } });
    expect(h.mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.org.hard_delete.storage_incomplete',
        targetId: ORG_ID,
        organizationId: ORG_ID,
        metadata: { failedUris: [`${BUCKET}/thumb.png`] },
      }),
    );
  });
});

describe('the Stripe subscription', () => {
  it('is never touched when cancelling was not requested', async () => {
    const result = await hardDeleteOrganization(ORG_ID, CONFIRM, ACTOR);

    expect(h.mockCancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'deleted', subscription: 'not_requested' });
  });

  it('is cancelled before the transaction when requested', async () => {
    const result = await hardDeleteOrganization(
      ORG_ID,
      { ...CONFIRM, cancelSubscription: true },
      ACTOR,
    );

    expect(h.mockCancel).toHaveBeenCalledWith(ORG_ID, 'sub_123');
    expect(h.order.indexOf('stripe.cancel')).toBeLessThan(h.order.indexOf('tx:begin'));
    expect(result).toMatchObject({ status: 'deleted', subscription: 'cancelled' });
  });

  it('reports a subscription Stripe had already ended', async () => {
    h.mockCancel.mockResolvedValue('already_cancelled');

    const result = await hardDeleteOrganization(
      ORG_ID,
      { ...CONFIRM, cancelSubscription: true },
      ACTOR,
    );

    expect(result).toMatchObject({ status: 'deleted', subscription: 'already_cancelled' });
  });

  it('refuses, deleting nothing, when Stripe fails', async () => {
    h.mockCancel.mockRejectedValue(new Error('stripe down'));

    await expect(
      hardDeleteOrganization(ORG_ID, { ...CONFIRM, cancelSubscription: true }, ACTOR),
    ).resolves.toEqual({
      status: 'refused',
      message: STRIPE_CANCEL_FAILED_REFUSAL,
      subscriptionCancelled: false,
    });
    expect(h.order).not.toContain('tx:begin');
  });

  it('says billing stopped when the in-lock re-check refuses after the cancel', async () => {
    h.state.responses['orgCourseOffering.count'] = (args, scope) =>
      scope === 'tx' && isCrossOrgQuery(args) ? 1 : 0;

    const result = await hardDeleteOrganization(
      ORG_ID,
      { ...CONFIRM, cancelSubscription: true },
      ACTOR,
    );

    expect(result).toMatchObject({ status: 'refused', subscriptionCancelled: true });
  });

  it('returns a refusal, not a throw, when the transaction fails after the cancel', async () => {
    h.state.txError = new Error('connection reset');

    await expect(
      hardDeleteOrganization(ORG_ID, { ...CONFIRM, cancelSubscription: true }, ACTOR),
    ).resolves.toEqual({
      status: 'refused',
      message: DELETE_FAILED_AFTER_CANCEL_REFUSAL,
      subscriptionCancelled: true,
    });
  });

  it('reports none, and calls nothing, when there is no subscription row', async () => {
    h.state.organization = organization({ subscription: null, stripeCustomerId: null });

    const result = await hardDeleteOrganization(
      ORG_ID,
      { ...CONFIRM, cancelSubscription: true },
      ACTOR,
    );

    expect(h.mockCancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'deleted', subscription: 'none' });
  });
});

describe('previewOrganizationHardDelete', () => {
  it('returns null for an unknown organization', async () => {
    h.state.organization = null;
    await expect(previewOrganizationHardDelete(ORG_ID)).resolves.toBeNull();
  });

  it('reports counts, kept records and a live subscription that can be cancelled', async () => {
    h.state.responses['organizationUser.count'] = (args) =>
      JSON.stringify(args).includes('organizationMemberships') ? 2 : 5;
    h.state.responses['auditLog.count'] = () => 11;

    const preview = await previewOrganizationHardDelete(ORG_ID);

    expect(preview).toMatchObject({
      enabled: true,
      refusal: null,
      organization: { id: ORG_ID, name: ORG_NAME, slug: 'acme', deletedAt: DELETED_AT },
      destroyed: { memberships: 5 },
      kept: {
        users: 5,
        usersAlsoInOtherOrgs: 2,
        usersLeftWithoutOrganization: 3,
        auditLogs: 11,
        stripeCustomer: true,
      },
      subscription: { plan: 'growth', status: 'active', cancelAtPeriodEnd: false },
      canCancelSubscription: true,
    });
    expect(writes('raw')).toEqual([]);
  });

  it('cannot cancel a subscription that is already canceled', async () => {
    h.state.organization = organization({
      subscription: {
        plan: 'growth',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: 'sub_123',
      },
    });

    const preview = await previewOrganizationHardDelete(ORG_ID);
    expect(preview?.canCancelSubscription).toBe(false);
  });

  it.each([
    [
      'the flag is off',
      () => vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', ''),
      HARD_DELETE_DISABLED_REFUSAL,
    ],
    [
      'the organization is not soft-deleted',
      () => {
        h.state.organization = organization({ deletedAt: null });
      },
      NOT_SOFT_DELETED_ORGANIZATION_REFUSAL,
    ],
  ])('carries the refusal when %s', async (_label, arrange, refusal) => {
    arrange();
    const preview = await previewOrganizationHardDelete(ORG_ID);
    expect(preview?.refusal).toBe(refusal);
  });
});
