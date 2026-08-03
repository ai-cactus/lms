/**
 * Unit tests for emitNotificationEvent — the single funnel every engine
 * notification goes through.
 *
 * Covers: digest tier leaves the outbox row `pending` + writes in-app rows;
 * instant tier emails immediately and marks `dispatched`; zero recipients →
 * `skipped`; unknown event type and thrown errors are swallowed (never throws);
 * the §2.2 fallback meta-alert fires once per missing role and is throttled 24h
 * via dedupeKey; the meta-alert itself never excludes the actor.
 *
 * `./catalog` (the routing table) and `getRoleDisplayName` are real — pure,
 * deterministic — so these tests also pin the wiring between emit and the
 * catalog rather than re-stating it as a mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockCreateNotification, mockSendInstantEmail, mockResolveRoleRecipients } =
  vi.hoisted(() => ({
    prismaMock: {
      notificationEvent: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    },
    mockCreateNotification: vi.fn(),
    mockSendInstantEmail: vi.fn(),
    mockResolveRoleRecipients: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/app/actions/notifications', () => ({ createNotification: mockCreateNotification }));
vi.mock('@/lib/email', () => ({ sendInstantNotificationEmail: mockSendInstantEmail }));
vi.mock('./recipients', () => ({ resolveRoleRecipients: mockResolveRoleRecipients }));

import { emitNotificationEvent } from './emit';

const NO_RECIPIENTS = { userIds: [], emails: [], usedFallback: false, missingRoles: [] };

function recipients(ids: string[], opts: { usedFallback?: boolean; missingRoles?: string[] } = {}) {
  return {
    userIds: ids,
    emails: ids.map((id) => ({ userId: id, email: `${id}@acme.com`, name: null })),
    usedFallback: opts.usedFallback ?? false,
    missingRoles: opts.missingRoles ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.notificationEvent.create.mockResolvedValue({ id: 'event-1' });
  prismaMock.notificationEvent.update.mockResolvedValue({});
  prismaMock.notificationEvent.findFirst.mockResolvedValue(null); // not throttled by default
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendInstantEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });
  mockResolveRoleRecipients.mockResolvedValue(NO_RECIPIENTS);
});

const baseInput = {
  organizationId: 'org-1',
  title: 'New staff member added',
  message: 'Someone joined',
};

describe('emitNotificationEvent — digest tier', () => {
  it('creates the outbox row pending, writes an in-app row per recipient, and never emails', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['hr-1', 'hr-2']));

    const result = await emitNotificationEvent({ ...baseInput, type: 'STAFF_ADDED' });

    expect(prismaMock.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tier: 'digest', status: 'pending', type: 'STAFF_ADDED' }),
      }),
    );
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'hr-1', type: 'STAFF_ADDED' }),
    );
    expect(mockSendInstantEmail).not.toHaveBeenCalled();
    expect(prismaMock.notificationEvent.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'pending',
      eventId: 'event-1',
      recipientCount: 2,
      usedFallback: false,
    });
  });

  it('routes STAFF_ADDED to HR with owner fallback when the actor is not HR (wiring through the real catalog)', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['hr-1']));

    await emitNotificationEvent({
      ...baseInput,
      type: 'STAFF_ADDED',
      actor: { userId: 'supervisor-1', role: 'supervisor' },
    });

    expect(mockResolveRoleRecipients).toHaveBeenCalledWith(
      'org-1',
      ['hr'],
      expect.objectContaining({ fallbackToOwner: true, excludeUserIds: ['supervisor-1'] }),
    );
  });

  it('routes STAFF_ADDED to the owner with no fallback when the actor IS HR', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['owner-1']));

    await emitNotificationEvent({
      ...baseInput,
      type: 'STAFF_ADDED',
      actor: { userId: 'hr-1', role: 'hr' },
    });

    expect(mockResolveRoleRecipients).toHaveBeenCalledWith(
      'org-1',
      ['owner'],
      expect.objectContaining({ fallbackToOwner: false, excludeUserIds: ['hr-1'] }),
    );
  });
});

describe('emitNotificationEvent — instant tier', () => {
  it('emails every recipient immediately and marks the event dispatched', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['owner-1']));

    const result = await emitNotificationEvent({
      ...baseInput,
      type: 'ROLE_FALLBACK_TRIGGERED',
      linkUrl: '/dashboard/staff',
    });

    expect(mockSendInstantEmail).toHaveBeenCalledExactlyOnceWith(
      'owner-1@acme.com',
      null,
      expect.objectContaining({ subject: baseInput.title, bodyLines: [baseInput.message] }),
    );
    expect(prismaMock.notificationEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { status: 'dispatched', dispatchedAt: expect.any(Date) },
    });
    expect(result.status).toBe('dispatched');
    expect(result.recipientCount).toBe(1);
  });
});

describe('emitNotificationEvent — zero recipients', () => {
  it('records the event as skipped, logs a warning, and returns status skipped', async () => {
    mockResolveRoleRecipients.mockResolvedValue(NO_RECIPIENTS);

    const result = await emitNotificationEvent({ ...baseInput, type: 'STAFF_ADDED' });

    expect(prismaMock.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'skipped' }) }),
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendInstantEmail).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'skipped',
      eventId: 'event-1',
      recipientCount: 0,
      usedFallback: false,
    });
  });
});

describe('emitNotificationEvent — resilience', () => {
  it('returns an error result (never throws) for an unrecognized event type', async () => {
    const result = await emitNotificationEvent({
      ...baseInput,
      // @ts-expect-error deliberately invalid to exercise the guard
      type: 'NOT_A_REAL_EVENT',
    });

    expect(result).toEqual({ status: 'error', recipientCount: 0, usedFallback: false });
    expect(prismaMock.notificationEvent.create).not.toHaveBeenCalled();
  });

  it('swallows an unexpected error (e.g. DB failure) and returns an error result', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['hr-1']));
    prismaMock.notificationEvent.create.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await emitNotificationEvent({ ...baseInput, type: 'STAFF_ADDED' });

    expect(result).toEqual({ status: 'error', recipientCount: 0, usedFallback: false });
  });

  it('never throws even if a dependency violates its own no-throw contract (e.g. email send rejects)', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['owner-1']));
    mockSendInstantEmail.mockRejectedValueOnce(new Error('SMTP down'));

    // sendInstantNotificationEmail is documented to never throw, but emit's own
    // top-level try/catch must still hold if that contract is ever violated —
    // the caller's business action must never be at risk either way.
    const result = await emitNotificationEvent({ ...baseInput, type: 'ROLE_FALLBACK_TRIGGERED' });

    expect(result.status).toBe('error');
  });
});

describe('emitNotificationEvent — dedupeKey throttling', () => {
  it('skips emitting (throttled) when an event with the same dedupeKey exists within 24h', async () => {
    prismaMock.notificationEvent.findFirst.mockResolvedValue({ id: 'existing-event' });

    const result = await emitNotificationEvent({
      ...baseInput,
      type: 'ROLE_FALLBACK_TRIGGERED',
      dedupeKey: 'role-fallback:hr',
    });

    expect(result).toEqual({ status: 'throttled', recipientCount: 0, usedFallback: false });
    expect(prismaMock.notificationEvent.create).not.toHaveBeenCalled();
    expect(mockResolveRoleRecipients).not.toHaveBeenCalled();
  });

  it('proceeds normally when no dedupeKey is provided', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['owner-1']));

    const result = await emitNotificationEvent({ ...baseInput, type: 'ROLE_FALLBACK_TRIGGERED' });

    expect(prismaMock.notificationEvent.findFirst).not.toHaveBeenCalled();
    expect(result.status).toBe('dispatched');
  });
});

describe('emitNotificationEvent — §2.2 fallback meta-alert', () => {
  it('fires ROLE_FALLBACK_TRIGGERED once when a digest event used the owner fallback', async () => {
    // First call: the STAFF_ADDED event itself, routed to the owner via fallback.
    mockResolveRoleRecipients.mockResolvedValueOnce(
      recipients(['owner-1'], { usedFallback: true, missingRoles: ['hr'] }),
    );
    // Second call: the recursive ROLE_FALLBACK_TRIGGERED emit resolving 'owner'.
    mockResolveRoleRecipients.mockResolvedValueOnce(recipients(['owner-1']));

    await emitNotificationEvent({
      ...baseInput,
      type: 'STAFF_ADDED',
      actor: { userId: 'supervisor-1', role: 'supervisor' },
    });

    // Two outbox rows: the original STAFF_ADDED event and the meta-alert.
    expect(prismaMock.notificationEvent.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.notificationEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ROLE_FALLBACK_TRIGGERED',
          dedupeKey: 'role-fallback:hr',
          tier: 'instant',
        }),
      }),
    );
    // The meta-alert is instant, so it emails the owner.
    expect(mockSendInstantEmail).toHaveBeenCalledOnce();
  });

  it('does NOT exclude the actor from the meta-alert, even though it excludes the actor from the original event', async () => {
    // The owner themself triggers the fallback (e.g. owner invites a worker in
    // an HR-less org) — they must still be told the role is vacant.
    mockResolveRoleRecipients.mockResolvedValueOnce(
      recipients([], { usedFallback: true, missingRoles: ['hr'] }),
    );
    mockResolveRoleRecipients.mockResolvedValueOnce(recipients(['owner-1']));

    await emitNotificationEvent({
      ...baseInput,
      type: 'STAFF_ADDED',
      actor: { userId: 'owner-1', role: 'owner' },
    });

    // The recursive resolveRoleRecipients call for the meta-alert must not
    // exclude anyone — it is called with excludeUserIds: [undefined] (no actor).
    expect(mockResolveRoleRecipients).toHaveBeenNthCalledWith(
      2,
      'org-1',
      ['owner'],
      expect.objectContaining({ excludeUserIds: [undefined] }),
    );
  });

  it('never recurses on the meta-alert itself, even if resolveRoleRecipients reports usedFallback', async () => {
    // Pathological input: ROLE_FALLBACK_TRIGGERED itself reporting a fallback.
    // emitFallbackAlert must short-circuit on `input.type === 'ROLE_FALLBACK_TRIGGERED'`.
    mockResolveRoleRecipients.mockResolvedValue(
      recipients(['owner-1'], { usedFallback: true, missingRoles: ['owner'] }),
    );

    await emitNotificationEvent({ ...baseInput, type: 'ROLE_FALLBACK_TRIGGERED' });

    expect(prismaMock.notificationEvent.create).toHaveBeenCalledTimes(1);
  });

  it('fires one meta-alert per missing role when multiple roles are unassigned', async () => {
    mockResolveRoleRecipients.mockResolvedValueOnce(
      recipients(['owner-1'], { usedFallback: true, missingRoles: ['hr', 'clinical_director'] }),
    );
    mockResolveRoleRecipients.mockResolvedValue(recipients(['owner-1']));

    await emitNotificationEvent({ ...baseInput, type: 'STAFF_ADDED', actor: null });

    const metaAlertCreates = prismaMock.notificationEvent.create.mock.calls.filter(
      (call) => call[0].data.type === 'ROLE_FALLBACK_TRIGGERED',
    );
    expect(metaAlertCreates).toHaveLength(2);
    expect(metaAlertCreates.map((c) => c[0].data.dedupeKey).sort()).toEqual([
      'role-fallback:clinical_director',
      'role-fallback:hr',
    ]);
  });

  it('does not fire a meta-alert when usedFallback is false', async () => {
    mockResolveRoleRecipients.mockResolvedValue(recipients(['hr-1']));

    await emitNotificationEvent({ ...baseInput, type: 'STAFF_ADDED' });

    expect(prismaMock.notificationEvent.create).toHaveBeenCalledTimes(1);
  });
});
