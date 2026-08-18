/* eslint-disable @typescript-eslint/no-explicit-any -- fake-Prisma/mock arg shapes in test doubles; matches the repo's test-mock convention */
/**
 * Tier 3 §5.3 PR-7 — end-to-end equivalence tests for `enrollUsers` and
 * `assignCourseToRole` (src/app/actions/enrollment.ts) across both states of
 * the `ENROLLMENT_BATCH_ENABLED` kill-switch.
 *
 * The core algorithmic equivalence between the batched (`createEnrollmentsForUsers`)
 * and sequential (`enrollSequentially`) paths is covered exhaustively in
 * ./../../lib/enrollment/create-batch.test.ts (seat-limit force-fail, already-enrolled
 * skip, no-duplicate-email guarantee, mixed-batch ordering, 50+ holder scale,
 * bounded concurrency, partial-failure semantics, and a confirmed divergence in
 * post-failure commit behavior). This file instead proves the WIRING: that
 * `enrollUsers`/`assignCourseToRole` genuinely read `process.env.ENROLLMENT_BATCH_ENABLED`
 * at call time and route to the matching function, and that the result-bucketing
 * (`success`/`alreadyEnrolled`/`newInvited`/`failed`) is identical end-to-end for
 * flag unset, `'false'`, and `'true'`.
 *
 * Email/invite-email call-COUNT assertions are intentionally avoided for batches
 * with 2+ distinct emails — see the header comment in create-batch.test.ts for why
 * (a Vitest dynamic-import mocking artifact under concurrency, not a product bug).
 * DB-write assertions here go through the statically-imported prisma mock, which is
 * reliable under the same concurrency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeUser {
  id: string;
  email: string;
  organizationId: string | null;
  role: string;
  profile: { fullName?: string | null } | null;
}
interface FakeEnrollment {
  id: string;
  userId: string;
  courseId: string;
}
interface FakeInvite {
  id: string;
  email: string;
  organizationId: string;
  status: 'pending';
  token: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: string;
}

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockCreateNotification,
  mockSendCourseInviteEmail,
  mockSendCourseLaunchEmail,
  mockSendCoursesAssignedEmail,
} = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    organization: { findUnique: vi.fn() },
    profile: { upsert: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn() },
    reminderLog: { create: vi.fn() },
    invite: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    inviteCourseAssignment: { upsert: vi.fn() },
  };
  return {
    prismaMock,
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockCreateNotification: vi.fn(),
    mockSendCourseInviteEmail: vi.fn(),
    mockSendCourseLaunchEmail: vi.fn(),
    mockSendCoursesAssignedEmail: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('./notifications', () => ({
  createNotification: mockCreateNotification,
  notifyOrganizationAdmins: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: mockSendCourseInviteEmail,
  sendCourseLaunchEmail: mockSendCourseLaunchEmail,
  // notifyCoursesAssigned (real, unmocked below) dynamically imports this.
  sendCoursesAssignedEmail: mockSendCoursesAssignedEmail,
}));

import { enrollUsers, assignCourseToRole } from './enrollment';
import { collectDeferredNotices, notifyCoursesAssigned } from '@/lib/enrollment/notify';
import type { StaffEntry } from '@/types/enrollment';
import type { UserRole } from '@/generated/prisma/enums';
import type { DeferredWorkerNotification } from '@/lib/enrollment/create';

const ADMIN_ID = 'admin-1';
const ORG_ID = 'org-1';
const COURSE_ID = 'course-1';

const ownCourse = {
  id: COURSE_ID,
  title: 'Safety Training',
  createdBy: ADMIN_ID,
  isGlobal: false,
  status: 'published',
};

interface Seed {
  users?: FakeUser[];
  enrollments?: FakeEnrollment[];
  invites?: FakeInvite[];
  orgSubscription?: { plan?: string; status: string; pausedAt: Date | null } | null;
  workerCount?: number;
  pendingInviteCount?: number;
}

function seedDb(seed: Seed = {}) {
  const state = {
    users: (seed.users ?? []).map((u) => ({ ...u })),
    enrollments: (seed.enrollments ?? []).map((e) => ({ ...e })),
    invites: (seed.invites ?? []).map((i) => ({ ...i })),
    orgSubscription:
      seed.orgSubscription === undefined
        ? { status: 'active', pausedAt: null } // active, no matching plan → getSeatUsage no-ops
        : seed.orgSubscription,
    workerCount: seed.workerCount ?? 0,
    pendingInviteCount: seed.pendingInviteCount ?? 0,
    nextEnrollmentId: 1,
    nextInviteId: 1,
  };

  prismaMock.course.findUnique.mockResolvedValue(ownCourse);

  prismaMock.user.findUnique.mockImplementation(async (args: any) => {
    if (args.where.id) {
      if (args.where.id !== ADMIN_ID) return null;
      return {
        id: ADMIN_ID,
        role: 'owner',
        organizationId: ORG_ID,
        organization: { id: ORG_ID, name: 'Acme Corp', subscription: state.orgSubscription },
      };
    }
    const email = args.where.email.toLowerCase();
    const u = state.users.find((u) => u.email.toLowerCase() === email);
    return u ? { ...u } : null;
  });

  prismaMock.user.findMany.mockImplementation(async (args: any) => {
    if (args.where?.role) {
      // assignCourseToRole holder query.
      return state.users
        .filter((u) => u.organizationId === args.where.organizationId && u.role === args.where.role)
        .map((u) => ({ id: u.id, email: u.email }));
    }
    const emails: string[] = args.where.email.in.map((e: string) => e.toLowerCase());
    if (args.include?.profile) {
      // createEnrollmentsForUsers batched read 1.
      return state.users
        .filter((u) => emails.includes(u.email.toLowerCase()))
        .map((u) => ({ ...u }));
    }
    // enrollUsers seat-gate existing-members query.
    return state.users
      .filter(
        (u) =>
          emails.includes(u.email.toLowerCase()) && u.organizationId === args.where.organizationId,
      )
      .map((u) => ({ email: u.email }));
  });

  prismaMock.user.count.mockImplementation(async () => state.workerCount);

  prismaMock.organization.findUnique.mockImplementation(async (args: any) => {
    if (args.where.id !== ORG_ID) return null;
    return { subscription: state.orgSubscription };
  });

  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-1' });
  prismaMock.assignmentReminderStage.upsert.mockResolvedValue({});
  prismaMock.orgCourseOffering.findUnique.mockResolvedValue(null);
  prismaMock.orgCourseOffering.upsert.mockResolvedValue({ id: 'offering-1' });
  prismaMock.facility.findFirst.mockResolvedValue(null);
  prismaMock.profile.upsert.mockResolvedValue({});
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log' });
  prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});

  prismaMock.enrollment.findFirst.mockImplementation(async (args: any) => {
    return (
      state.enrollments.find(
        (e) => e.userId === args.where.userId && e.courseId === args.where.courseId,
      ) ?? null
    );
  });
  prismaMock.enrollment.findMany.mockImplementation(async (args: any) => {
    const ids: string[] = args.where.userId.in;
    return state.enrollments
      .filter((e) => e.courseId === args.where.courseId && ids.includes(e.userId))
      .map((e) => ({ userId: e.userId }));
  });
  prismaMock.enrollment.create.mockImplementation(async (args: any) => {
    const id = `enr-${state.nextEnrollmentId++}`;
    state.enrollments.push({ id, userId: args.data.userId, courseId: args.data.courseId });
    return { id, ...args.data };
  });

  prismaMock.invite.count.mockImplementation(async () => state.pendingInviteCount);
  prismaMock.invite.findFirst.mockImplementation(async (args: any) => {
    const matches = state.invites
      .filter(
        (i) =>
          i.email.toLowerCase() === args.where.email.toLowerCase() &&
          i.organizationId === args.where.organizationId &&
          i.status === args.where.status,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  });
  prismaMock.invite.findMany.mockImplementation(async (args: any) => {
    const emails: string[] = args.where.email.in.map((e: string) => e.toLowerCase());
    const base = state.invites.filter(
      (i) =>
        emails.includes(i.email.toLowerCase()) &&
        i.organizationId === args.where.organizationId &&
        i.status === 'pending',
    );
    if (args.select) {
      const now = new Date();
      return base.filter((i) => i.expiresAt > now).map((i) => ({ email: i.email }));
    }
    return [...base].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });
  prismaMock.invite.create.mockImplementation(async (args: any) => {
    const id = `inv-${state.nextInviteId++}`;
    const record: FakeInvite = { id, createdAt: new Date(), ...args.data };
    state.invites.push(record);
    return record;
  });
  prismaMock.invite.update.mockImplementation(async (args: any) => {
    const inv = state.invites.find((i) => i.id === args.where.id);
    if (!inv) throw new Error(`no invite ${args.where.id}`);
    Object.assign(inv, args.data);
    return { ...inv };
  });

  return state;
}

function member(id: string, email: string, role = 'nurse'): FakeUser {
  return { id, email, organizationId: ORG_ID, role, profile: { fullName: null } };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mockAdminAuth.mockResolvedValue({ user: { id: ADMIN_ID } });
  mockWorkerAuth.mockResolvedValue(null);
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCourseInviteEmail.mockResolvedValue(undefined);
  mockSendCourseLaunchEmail.mockResolvedValue(undefined);
  mockSendCoursesAssignedEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });
});

afterEach(() => {
  delete process.env.ENROLLMENT_BATCH_ENABLED;
});

type FlagState = 'unset' | 'false' | 'true';
function setFlag(flag: FlagState) {
  if (flag === 'unset') delete process.env.ENROLLMENT_BATCH_ENABLED;
  else process.env.ENROLLMENT_BATCH_ENABLED = flag;
}

const FLAG_STATES: FlagState[] = ['unset', 'false', 'true'];

/**
 * The `assignCourseToRole` 50+-holder equivalence spec below (and its 3-holder
 * neighbor) drive many sequential in-memory-mock DB calls per `it.each` case;
 * under a busy machine that intermittently exceeds vitest's 5s default and times
 * out — deterministic-but-marginal, not flaky logic. Pre-existing on `main`
 * (reproduced there independently of this branch's changes, which never touch
 * `createEnrollmentsForUsers`). Mirrors the same fix already applied file-wide in
 * ../../lib/enrollment/create-batch.test.ts for the identical symptom.
 */
vi.setConfig({ testTimeout: 20_000 });

describe('enrollUsers — ENROLLMENT_BATCH_ENABLED equivalence', () => {
  it.each(FLAG_STATES)(
    'flag=%s: enrolls a mixed batch (existing member, new invite, seat-rejected) into identical buckets',
    async (flag) => {
      setFlag(flag);
      seedDb({
        users: [member('u-1', 'staff@example.com')],
        orgSubscription: { plan: 'starter', status: 'active', pausedAt: null }, // staffMax 10
        workerCount: 10, // at cap — any brand-new email is rejected
      });

      const entries: StaffEntry[] = [
        { email: 'staff@example.com' }, // existing member → success
        { email: 'brandnew@example.com' }, // unknown, at seat cap → failed
      ];

      const result = await enrollUsers(COURSE_ID, entries);

      expect(result.success).toEqual(['staff@example.com']);
      expect(result.failed).toEqual(['brandnew@example.com']);
      expect(result.newInvited).toEqual([]);
      expect(result.alreadyEnrolled).toEqual([]);
      expect(prismaMock.invite.create).not.toHaveBeenCalled();
    },
  );

  it.each(FLAG_STATES)(
    'flag=%s: an already-enrolled staff member is bucketed as alreadyEnrolled, no duplicate write',
    async (flag) => {
      setFlag(flag);
      seedDb({
        users: [member('u-1', 'staff@example.com')],
        enrollments: [{ id: 'enr-existing', userId: 'u-1', courseId: COURSE_ID }],
      });

      const result = await enrollUsers(COURSE_ID, [{ email: 'staff@example.com' }]);

      expect(result.alreadyEnrolled).toEqual(['staff@example.com']);
      expect(result.success).toEqual([]);
      expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    },
  );

  it.each(FLAG_STATES)(
    'flag=%s: an unknown email is invited, not account-created, mapped into newInvited',
    async (flag) => {
      setFlag(flag);
      seedDb();

      const result = await enrollUsers(COURSE_ID, [{ email: 'unknown@example.com' }]);

      expect(result.newInvited).toEqual(['unknown@example.com']);
      expect(result.success).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(prismaMock.invite.create).toHaveBeenCalledTimes(1);
    },
  );

  it('produces byte-identical results between flag UNSET and flag "false" (the fallback path is untouched)', async () => {
    const buildSeed = () => ({
      users: [member('u-1', 'existing@example.com'), member('u-2', 'holder2@example.com')],
    });
    const entries: StaffEntry[] = [
      { email: 'existing@example.com' },
      { email: 'unknown@example.com' },
      { email: 'not-an-email' },
    ];

    setFlag('unset');
    seedDb(buildSeed());
    const unsetResult = await enrollUsers(COURSE_ID, entries);

    vi.clearAllMocks();
    mockAdminAuth.mockResolvedValue({ user: { id: ADMIN_ID } });
    mockWorkerAuth.mockResolvedValue(null);
    mockCreateNotification.mockResolvedValue(undefined);
    mockSendCourseInviteEmail.mockResolvedValue(undefined);
    mockSendCourseLaunchEmail.mockResolvedValue(undefined);
    setFlag('false');
    seedDb(buildSeed());
    const falseResult = await enrollUsers(COURSE_ID, entries);

    expect(falseResult).toEqual(unsetResult);
  });
});

/**
 * deferWorkerNotification equivalence: `createEnrollmentsForUsers` (the
 * batched path) forwards its context verbatim, so this must hold identically
 * whether ENROLLMENT_BATCH_ENABLED routes through it or through
 * `enrollSequentially`.
 */
describe('enrollUsers — deferWorkerNotification equivalence across ENROLLMENT_BATCH_ENABLED', () => {
  it.each(['false', 'true'] as const)(
    'flag=%s: returns one deferred payload per newly enrolled member, and collectDeferredNotices/notifyCoursesAssigned send the email exactly once',
    async (flag) => {
      setFlag(flag);
      seedDb({
        users: [member('u-1', 'nurse1@example.com'), member('u-2', 'nurse2@example.com')],
      });

      const result = await enrollUsers(
        COURSE_ID,
        [{ email: 'nurse1@example.com' }, { email: 'nurse2@example.com' }],
        undefined,
        { deferWorkerNotification: true },
      );

      expect(result.success).toEqual(['nurse1@example.com', 'nurse2@example.com']);
      expect(result.deferred).toHaveLength(2);
      // Two DIFFERENT workers, not one worker with two courses — one notice per worker.
      const notices = collectDeferredNotices(result.deferred as DeferredWorkerNotification[]);
      expect(notices).toHaveLength(2);

      for (const notice of notices) {
        await notifyCoursesAssigned(notice);
      }

      expect(mockSendCoursesAssignedEmail).toHaveBeenCalledTimes(2);
      expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
    },
  );

  it('the deferred payloads are deep-equal between flag states — `DeferredWorkerNotification` carries no enrollmentId to diverge on, unlike the outer EnrollmentOutcome', async () => {
    // No explicit deadline in assignmentSettings ⇒ computeDueAt falls back to a
    // default window measured from "now" — pin the clock so both calls compute
    // the exact same dueAt instead of differing by the wall-clock ms between them.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
    try {
      const buildSeed = () => ({ users: [member('u-1', 'nurse1@example.com')] });
      const entries: StaffEntry[] = [{ email: 'nurse1@example.com' }];

      setFlag('false');
      seedDb(buildSeed());
      const falseResult = await enrollUsers(COURSE_ID, entries, undefined, {
        deferWorkerNotification: true,
      });

      vi.clearAllMocks();
      mockAdminAuth.mockResolvedValue({ user: { id: ADMIN_ID } });
      mockWorkerAuth.mockResolvedValue(null);
      setFlag('true');
      seedDb(buildSeed());
      const trueResult = await enrollUsers(COURSE_ID, entries, undefined, {
        deferWorkerNotification: true,
      });

      expect(trueResult.deferred).toEqual(falseResult.deferred);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('assignCourseToRole — ENROLLMENT_BATCH_ENABLED equivalence', () => {
  it.each(FLAG_STATES)('flag=%s: enrolls every current role holder exactly once', async (flag) => {
    setFlag(flag);
    const holders: FakeUser[] = [
      member('u-1', 'nurse1@example.com', 'nurse'),
      member('u-2', 'nurse2@example.com', 'nurse'),
      member('u-3', 'nurse3@example.com', 'nurse'),
    ];
    seedDb({ users: holders });

    const result = await assignCourseToRole(COURSE_ID, 'nurse' as UserRole);

    expect(result.holderCount).toBe(3);
    expect(result.enrolled).toBe(3);
    expect(result.alreadyEnrolled).toBe(0);
    expect(result.failed).toBe(0);
    expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(3);
  });

  it.each(FLAG_STATES)(
    'flag=%s: scales to 50+ current holders with correct counts',
    async (flag) => {
      setFlag(flag);
      const holderCount = 55;
      const holders: FakeUser[] = Array.from({ length: holderCount }, (_, i) =>
        member(`u-${i}`, `holder${i}@example.com`, 'front_desk_admin'),
      );
      seedDb({ users: holders });

      const result = await assignCourseToRole(COURSE_ID, 'front_desk_admin' as UserRole);

      expect(result.holderCount).toBe(holderCount);
      expect(result.enrolled).toBe(holderCount);
      expect(result.failed).toBe(0);
      expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(holderCount);
    },
  );
});
