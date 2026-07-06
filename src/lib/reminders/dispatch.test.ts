/**
 * Unit tests for src/lib/reminders/dispatch.ts
 *
 * dispatchLadderStage: dry-run, happy-path (worker audience), escalation
 *   audience, P2002 idempotency, non-P2002 DB error, email-throw resilience.
 *
 * dispatchNudge: no-existing sends, throttle suppresses, elapsed-interval
 *   sends, dry-run no-writes, WORKER_RETAKE targets worker, ADMIN_REASSIGN
 *   targets recipients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockCreateNotification,
  mockResolveEscalationRecipients,
  MockPrismaKnownRequestError,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => {
  const prismaMock = {
    reminderLog: { create: vi.fn() },
    reminderNudge: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  const mockCreateNotification = vi.fn();
  const mockResolveEscalationRecipients = vi.fn();
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();

  // Fake PrismaClientKnownRequestError — instances of this class pass the
  // `instanceof Prisma.PrismaClientKnownRequestError` check inside dispatch.ts
  // because both this file and dispatch.ts receive the same mock class.
  class MockPrismaKnownRequestError extends Error {
    code: string;
    clientVersion: string;
    constructor(message: string, { code, clientVersion }: { code: string; clientVersion: string }) {
      super(message);
      this.code = code;
      this.clientVersion = clientVersion;
      this.name = 'PrismaClientKnownRequestError';
    }
  }

  return {
    prismaMock,
    mockCreateNotification,
    mockResolveEscalationRecipients,
    MockPrismaKnownRequestError,
    mockLoggerInfo,
    mockLoggerError,
  };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));

vi.mock('@/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));

vi.mock('@/app/actions/notifications', () => ({
  createNotification: mockCreateNotification,
}));

vi.mock('@/lib/reminders/recipients', () => ({
  resolveEscalationRecipients: mockResolveEscalationRecipients,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
  maskEmail: (e: string) => e,
}));

import { dispatchLadderStage, dispatchNudge } from './dispatch';

const WORKER = { id: 'user-1', email: 'worker@test.com', name: 'Test Worker' };
const ENROLLMENT = { id: 'enroll-1', userId: 'user-1', courseId: 'course-1' };
const ESCALATION_RECIPIENTS = {
  userIds: ['admin-1'],
  emails: [{ email: 'admin@test.com', name: 'Admin Name' }],
};

/** Base input for dispatchLadderStage — easy to spread-override per test. */
const baseLadderInput = () => ({
  enrollment: ENROLLMENT,
  courseTitle: 'Safety Training',
  worker: WORKER,
  stage: 'FRIENDLY_REMINDER' as const,
  channels: ['email', 'in_app'] as string[],
  targetDate: new Date('2024-06-15T04:00:00Z'),
  dueAt: new Date('2024-06-29T04:00:00Z'),
  timezone: 'America/New_York',
  dryRun: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log-1' });
  mockCreateNotification.mockResolvedValue(undefined);
  mockResolveEscalationRecipients.mockResolvedValue(ESCALATION_RECIPIENTS);
  prismaMock.reminderNudge.findUnique.mockResolvedValue(null);
  prismaMock.reminderNudge.upsert.mockResolvedValue({});
});

describe('dispatchLadderStage', () => {
  describe('dry-run', () => {
    it('returns {sent:false, reason:"dry-run"} without any DB writes', async () => {
      const sendEmail = vi.fn();
      const result = await dispatchLadderStage({ ...baseLadderInput(), dryRun: true, sendEmail });

      expect(result).toEqual({ sent: false, reason: 'dry-run' });
      expect(prismaMock.reminderLog.create).not.toHaveBeenCalled();
      expect(mockCreateNotification).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('happy path — FRIENDLY_REMINDER (audience: worker)', () => {
    it('creates the ReminderLog, notifies the worker in-app, and sends email to the worker', async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined);

      const result = await dispatchLadderStage({
        ...baseLadderInput(),
        stage: 'FRIENDLY_REMINDER',
        sendEmail,
      });

      expect(result).toEqual({ sent: true, reason: 'sent' });

      // Dedup log created with correct fields
      expect(prismaMock.reminderLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enrollmentId: 'enroll-1', stage: 'FRIENDLY_REMINDER' }),
        }),
      );

      // In-app notification for the worker
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'COURSE_DEADLINE_REMINDER',
          linkUrl: '/worker/trainings',
        }),
      );

      // Email for the worker
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'worker@test.com',
          recipientRole: 'worker',
          stage: 'FRIENDLY_REMINDER',
        }),
      );

      // No escalation recipients queried for a worker-only stage
      expect(mockResolveEscalationRecipients).not.toHaveBeenCalled();
    });
  });

  describe('happy path — HARD_ESCALATION (audience: escalation only)', () => {
    it('notifies escalation recipients only — no worker notification', async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined);

      const result = await dispatchLadderStage({
        ...baseLadderInput(),
        stage: 'HARD_ESCALATION',
        dueAt: new Date('2024-06-08T04:00:00Z'), // 7 days before target
        sendEmail,
      });

      expect(result).toEqual({ sent: true, reason: 'sent' });

      // resolveEscalationRecipients invoked
      expect(mockResolveEscalationRecipients).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );

      // In-app for escalation admin
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: 'COMPLIANCE_ESCALATION',
        }),
      );

      // Email for escalation admin
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@test.com',
          recipientRole: 'escalation',
          stage: 'HARD_ESCALATION',
        }),
      );

      // Worker createNotification NOT called (escalation-only stage)
      const workerCalls = mockCreateNotification.mock.calls.filter(
        ([arg]) => arg.userId === 'user-1',
      );
      expect(workerCalls).toHaveLength(0);
    });
  });

  describe('happy path — GRACE_SOFT_ESCALATION (audience: worker_and_escalation)', () => {
    it('notifies both the worker and escalation recipients', async () => {
      const sendEmail = vi.fn().mockResolvedValue(undefined);

      const result = await dispatchLadderStage({
        ...baseLadderInput(),
        stage: 'GRACE_SOFT_ESCALATION',
        dueAt: new Date('2024-06-12T04:00:00Z'),
        sendEmail,
      });

      expect(result).toEqual({ sent: true, reason: 'sent' });

      // Worker in-app notification
      const workerNotif = mockCreateNotification.mock.calls.find(([a]) => a.userId === 'user-1');
      expect(workerNotif).toBeDefined();

      // Escalation in-app notification
      const escalationNotif = mockCreateNotification.mock.calls.find(
        ([a]) => a.userId === 'admin-1',
      );
      expect(escalationNotif).toBeDefined();

      // Two email sends (worker + admin)
      expect(sendEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe('idempotency — P2002 unique constraint', () => {
    it('returns {sent:false, reason:"duplicate"} and does NOT send when log already exists', async () => {
      const sendEmail = vi.fn();
      const dupErr = new MockPrismaKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.8.0',
      });
      prismaMock.reminderLog.create.mockRejectedValue(dupErr);

      const result = await dispatchLadderStage({ ...baseLadderInput(), sendEmail });

      expect(result).toEqual({ sent: false, reason: 'duplicate' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });
  });

  describe('non-P2002 DB error', () => {
    it('returns {sent:false, reason:"error"} when reminderLog.create throws an unexpected error', async () => {
      prismaMock.reminderLog.create.mockRejectedValue(new Error('DB connection lost'));
      const sendEmail = vi.fn();

      const result = await dispatchLadderStage({ ...baseLadderInput(), sendEmail });

      expect(result).toEqual({ sent: false, reason: 'error' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('Failed to dispatch ladder stage'),
        }),
      );
    });
  });

  describe('resilience — sendEmail throws', () => {
    it('returns {sent:false, reason:"error"} and does not propagate when sendEmail rejects', async () => {
      const sendEmail = vi.fn().mockRejectedValue(new Error('SMTP failure'));

      const result = await dispatchLadderStage({ ...baseLadderInput(), sendEmail });

      expect(result).toEqual({ sent: false, reason: 'error' });
      // The function must NOT throw — result (not an exception) is the contract
    });
  });
});

describe('dispatchNudge', () => {
  const NOW = new Date('2024-06-15T12:00:00Z');

  const baseNudgeInput = (overrides: Partial<Parameters<typeof dispatchNudge>[0]> = {}) => ({
    kind: 'WORKER_RETAKE' as const,
    enrollmentId: 'enroll-1',
    courseId: 'course-1',
    courseTitle: 'Safety Training',
    worker: WORKER,
    recipients: { userIds: [], emails: [] },
    nudgeIntervalDays: 3,
    attemptsRemaining: 2,
    now: NOW,
    dryRun: false,
    sendEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  describe('no existing nudge', () => {
    it('sends the notification, sends email, and upserts the ReminderNudge row', async () => {
      prismaMock.reminderNudge.findUnique.mockResolvedValue(null);
      const sendEmail = vi.fn().mockResolvedValue(undefined);

      const result = await dispatchNudge(baseNudgeInput({ sendEmail }));

      expect(result).toEqual({ sent: true, reason: 'sent' });
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', type: 'COURSE_RETAKE_REMINDER' }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'worker@test.com',
          kind: 'WORKER_RETAKE',
          recipientRole: 'worker',
        }),
      );
      expect(prismaMock.reminderNudge.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enrollmentId_kind: { enrollmentId: 'enroll-1', kind: 'WORKER_RETAKE' } },
          create: expect.objectContaining({
            enrollmentId: 'enroll-1',
            kind: 'WORKER_RETAKE',
            count: 1,
          }),
        }),
      );
    });
  });

  describe('throttle — interval not yet elapsed', () => {
    it('returns {sent:false, reason:"throttled"} when nudge was sent within the interval', async () => {
      // lastSentAt = 1 day ago; intervalDays = 3 → not elapsed
      prismaMock.reminderNudge.findUnique.mockResolvedValue({
        lastSentAt: new Date('2024-06-14T12:00:00Z'), // 1 day ago
      });
      const sendEmail = vi.fn();

      const result = await dispatchNudge(baseNudgeInput({ nudgeIntervalDays: 3, sendEmail }));

      expect(result).toEqual({ sent: false, reason: 'throttled' });
      expect(prismaMock.reminderNudge.upsert).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('throttle — interval elapsed', () => {
    it('sends when the elapsed time exceeds the interval', async () => {
      // lastSentAt = 5 days ago; intervalDays = 3 → elapsed
      prismaMock.reminderNudge.findUnique.mockResolvedValue({
        lastSentAt: new Date('2024-06-10T12:00:00Z'), // 5 days ago
      });

      const result = await dispatchNudge(baseNudgeInput({ nudgeIntervalDays: 3 }));

      expect(result).toEqual({ sent: true, reason: 'sent' });
    });
  });

  describe('dry-run (throttle check passes)', () => {
    it('returns {sent:false, reason:"dry-run"} without any writes when not throttled', async () => {
      prismaMock.reminderNudge.findUnique.mockResolvedValue(null); // not throttled
      const sendEmail = vi.fn();

      const result = await dispatchNudge(baseNudgeInput({ dryRun: true, sendEmail }));

      expect(result).toEqual({ sent: false, reason: 'dry-run' });
      expect(prismaMock.reminderNudge.upsert).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });
  });

  describe('ADMIN_REASSIGN kind', () => {
    it('notifies escalation recipients and sends escalation email (not the worker)', async () => {
      prismaMock.reminderNudge.findUnique.mockResolvedValue(null);
      const sendEmail = vi.fn().mockResolvedValue(undefined);
      const recipients = {
        userIds: ['admin-1'],
        emails: [{ email: 'admin@test.com', name: 'Admin Name' }],
      };

      const result = await dispatchNudge(
        baseNudgeInput({
          kind: 'ADMIN_REASSIGN',
          recipients,
          sendEmail,
        }),
      );

      expect(result).toEqual({ sent: true, reason: 'sent' });

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: 'QUIZ_RETRY_LIMIT_REACHED',
        }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@test.com',
          kind: 'ADMIN_REASSIGN',
          recipientRole: 'escalation',
        }),
      );

      // Worker createNotification NOT called
      const workerCalls = mockCreateNotification.mock.calls.filter(([a]) => a.userId === 'user-1');
      expect(workerCalls).toHaveLength(0);
    });
  });

  describe('WORKER_RETAKE — attemptsRemaining passed through', () => {
    it('includes attemptsRemaining in the email message', async () => {
      prismaMock.reminderNudge.findUnique.mockResolvedValue(null);
      const sendEmail = vi.fn().mockResolvedValue(undefined);

      await dispatchNudge(baseNudgeInput({ attemptsRemaining: 2, sendEmail }));

      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ attemptsRemaining: 2 }));
    });
  });

  describe('resilience — never throws', () => {
    it('returns {sent:false, reason:"error"} when createNotification rejects', async () => {
      prismaMock.reminderNudge.findUnique.mockResolvedValue(null);
      mockCreateNotification.mockRejectedValue(new Error('Notification service down'));

      const result = await dispatchNudge(baseNudgeInput());

      expect(result).toEqual({ sent: false, reason: 'error' });
    });
  });
});
