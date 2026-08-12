/* eslint-disable @typescript-eslint/no-explicit-any -- fake-Prisma/mock arg shapes in test doubles; matches the repo's test-mock convention */
/**
 * Tier 3 §5.3 PR-7 — equivalence + behavioral tests for the batched enrollment
 * path (`createEnrollmentsForUsers`) against the sequential reference (calling
 * `createEnrollmentForUser` once per entry in order — exactly what
 * `enrollSequentially` in src/app/actions/enrollment.ts does; that helper is
 * not exported, so the loop is reproduced verbatim here as the comparison
 * baseline).
 *
 * A small in-memory fake DB backs the prisma mock so both paths observe (and
 * mutate) the SAME kind of state a real database would — this is what lets the
 * "duplicate email in one batch only consumes one seat / writes one
 * enrollment" guarantee be checked meaningfully rather than asserted against a
 * static fixture.
 *
 * IMPORTANT — email/invite-count assertions under concurrency: createEnrollmentForUser
 * resolves `@/lib/email` and `crypto` via a DYNAMIC `await import(...)` on every
 * call. Vitest's mock interception for a dynamically-imported module is only
 * reliable when that import path is exercised sequentially in-process — when 2+
 * distinct-email groups run concurrently (exactly what createEnrollmentsForUsers's
 * worker pool does), only the first concurrent `import()` reliably resolves to the
 * mock; the rest can silently fall through to the real module (confirmed via an
 * isolated repro — see .claude/agent-memory/bug-hunter/vitest-concurrent-dynamic-import-mock-race.md).
 * This is a Vitest test-infra artifact, not a real Node.js/production hazard (real
 * dynamic import() dedupes concurrent loads of an already-resolved specifier). So:
 * email call-COUNT assertions here are only trusted for (a) single-entry batches, or
 * (b) duplicate-email batches, where the repo's own grouping guarantees the entries
 * run sequentially within one group — never for a batch with 2+ distinct emails.
 * For those wider batches, equivalence is asserted via the prisma mock instead
 * (`enrollment.create` / `invite.create`), which is imported statically in
 * create.ts and was rock solid under the same concurrent load in every check
 * performed while building this suite (verified up to 60-way concurrency).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeUser {
  id: string;
  email: string;
  organizationId: string | null;
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

const { prismaMock, mockCreateNotification, mockSendCourseInviteEmail, mockSendCourseLaunchEmail } =
  vi.hoisted(() => {
    const prismaMock = {
      user: { findUnique: vi.fn(), findMany: vi.fn() },
      profile: { upsert: vi.fn() },
      enrollment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      reminderLog: { create: vi.fn() },
      invite: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
      inviteCourseAssignment: { upsert: vi.fn() },
    };
    return {
      prismaMock,
      mockCreateNotification: vi.fn(),
      mockSendCourseInviteEmail: vi.fn(),
      mockSendCourseLaunchEmail: vi.fn(),
    };
  });

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/notifications', () => ({ createNotification: mockCreateNotification }));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: mockSendCourseInviteEmail,
  sendCourseLaunchEmail: mockSendCourseLaunchEmail,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import {
  createEnrollmentForUser,
  createEnrollmentsForUsers,
  type CreateEnrollmentContext,
  type EnrollmentOutcome,
} from './create';
import type { StaffEntry } from '@/types/enrollment';

/**
 * These specs are slow by construction, not by accident: each one drives 25-50
 * simulated members through BOTH the batched and the sequential path against an
 * in-memory fake DB, and the concurrency spec additionally holds 25 deferred
 * promises open to observe how many writes are in flight. Measured locally:
 * 2.5s, 4.3s, 2.7s, 2.7s — four of ten tests within 2x of vitest's 5s default,
 * and the concurrency one landing at 5004ms on a machine under load.
 *
 * That is deterministic-but-marginal rather than flaky: it passes on an idle
 * machine and fails on a busy one, which made the pre-push hook block a push
 * whose CI run was green. Raised file-wide rather than on the single failing
 * spec, because its three siblings sit in the same band.
 *
 * This buys headroom; it does not make the suite fast. If these grow further,
 * the fix is the harness (the fake DB and the per-entry awaits), not the limit.
 */
vi.setConfig({ testTimeout: 20_000 });

const CTX: CreateEnrollmentContext = {
  courseId: 'course-1',
  courseTitle: 'Safety Training',
  organizationId: 'org-1',
  organizationName: 'Acme Corp',
  facilityId: null,
  assignmentId: 'assignment-1',
  scheduleAt: null,
  assignmentDueAt: new Date('2026-09-01T00:00:00Z'), // fixed — avoids new Date() drift in assertions
  assignmentWindowDays: null,
  enrolledByUserId: 'admin-1',
};

/** Reproduces enrollSequentially (src/app/actions/enrollment.ts) verbatim as the reference path. */
async function runSequential(
  entries: StaffEntry[],
  ctx: CreateEnrollmentContext,
  skipEmails: ReadonlySet<string>,
): Promise<EnrollmentOutcome[]> {
  const outcomes: EnrollmentOutcome[] = [];
  for (const entry of entries) {
    const normalizedEmail = entry.email.toLowerCase().trim();
    if (skipEmails.has(normalizedEmail)) {
      outcomes.push({ status: 'failed', email: normalizedEmail });
      continue;
    }
    outcomes.push(await createEnrollmentForUser(entry, ctx));
  }
  return outcomes;
}

interface Seed {
  users?: FakeUser[];
  enrollments?: FakeEnrollment[];
  invites?: FakeInvite[];
}

function seedDb(seed: Seed = {}) {
  const state = {
    users: (seed.users ?? []).map((u) => ({ ...u })),
    enrollments: (seed.enrollments ?? []).map((e) => ({ ...e })),
    invites: (seed.invites ?? []).map((i) => ({ ...i })),
    nextEnrollmentId: 1,
    nextInviteId: 1,
  };

  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
    const email = where.email.toLowerCase();
    const u = state.users.find((u) => u.email.toLowerCase() === email);
    return u ? { ...u } : null;
  });

  prismaMock.user.findMany.mockImplementation(async ({ where }: any) => {
    const emails: string[] = where.email.in.map((e: string) => e.toLowerCase());
    return state.users.filter((u) => emails.includes(u.email.toLowerCase())).map((u) => ({ ...u }));
  });

  prismaMock.enrollment.findFirst.mockImplementation(async ({ where }: any) => {
    return (
      state.enrollments.find((e) => e.userId === where.userId && e.courseId === where.courseId) ??
      null
    );
  });

  prismaMock.enrollment.findMany.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where.userId.in;
    return state.enrollments
      .filter((e) => e.courseId === where.courseId && ids.includes(e.userId))
      .map((e) => ({ userId: e.userId }));
  });

  prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => {
    const id = `enr-${state.nextEnrollmentId++}`;
    state.enrollments.push({ id, userId: data.userId, courseId: data.courseId });
    return { id, ...data };
  });

  prismaMock.invite.findFirst.mockImplementation(async ({ where }: any) => {
    const matches = state.invites
      .filter(
        (i) =>
          i.email.toLowerCase() === where.email.toLowerCase() &&
          i.organizationId === where.organizationId &&
          i.status === where.status,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  });

  prismaMock.invite.findMany.mockImplementation(async ({ where }: any) => {
    const emails: string[] = where.email.in.map((e: string) => e.toLowerCase());
    return state.invites
      .filter(
        (i) =>
          emails.includes(i.email.toLowerCase()) &&
          i.organizationId === where.organizationId &&
          i.status === where.status,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });

  prismaMock.invite.create.mockImplementation(async ({ data }: any) => {
    const id = `inv-${state.nextInviteId++}`;
    const record: FakeInvite = { id, createdAt: new Date(), ...data };
    state.invites.push(record);
    return record;
  });

  prismaMock.invite.update.mockImplementation(async ({ where, data }: any) => {
    const inv = state.invites.find((i) => i.id === where.id);
    if (!inv) throw new Error(`no invite ${where.id}`);
    Object.assign(inv, data);
    return { ...inv };
  });

  prismaMock.profile.upsert.mockResolvedValue({});
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log' });
  prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({});

  return state;
}

/** userId/enrollmentId are real-DB-generated — strip them so two independently seeded runs compare on business fields only. */
function normalizeOutcomes(outcomes: EnrollmentOutcome[]) {
  return outcomes.map((o) => ({ ...o, userId: undefined, enrollmentId: undefined }));
}

function enrollmentCreateUserIds() {
  return prismaMock.enrollment.create.mock.calls.map(([args]: any[]) => args.data.userId);
}
function inviteCreateEmails() {
  return prismaMock.invite.create.mock.calls.map(([args]: any[]) => args.data.email);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCourseInviteEmail.mockResolvedValue(undefined);
  mockSendCourseLaunchEmail.mockResolvedValue(undefined);
});

function existingMember(id: string, email: string): FakeUser {
  return { id, email, organizationId: 'org-1', profile: { fullName: null } };
}

describe('createEnrollmentsForUsers — equivalence with the sequential reference path', () => {
  it('produces identical outcomes (status, order, bucketing) for a mixed batch: new / existing / cross-tenant / org-less-invite / malformed / seat-rejected', async () => {
    const seed: Seed = {
      users: [
        existingMember('u-existing', 'existing@example.com'),
        { id: 'u-other-org', email: 'foreign@example.com', organizationId: 'org-2', profile: null },
        { id: 'u-orgless', email: 'orgless@example.com', organizationId: null, profile: null },
      ],
    };
    const entries: StaffEntry[] = [
      { email: 'new@example.com' }, // unknown → invited
      { email: 'existing@example.com' }, // existing member → enrolled
      { email: 'foreign@example.com' }, // cross-tenant → failed
      { email: 'orgless@example.com' }, // org-less account → invited
      { email: 'not-an-email' }, // malformed → failed
      { email: 'rejected@example.com' }, // seat-rejected → failed, no DB writes
    ];
    const skipEmails = new Set(['rejected@example.com']);

    seedDb(seed);
    const seqOutcomes = await runSequential(entries, CTX, skipEmails);
    const seqInviteEmails = new Set(inviteCreateEmails());
    const seqEnrollUserIds = enrollmentCreateUserIds();

    vi.clearAllMocks();
    mockCreateNotification.mockResolvedValue(undefined);
    mockSendCourseInviteEmail.mockResolvedValue(undefined);
    mockSendCourseLaunchEmail.mockResolvedValue(undefined);
    seedDb(seed);
    const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, skipEmails);
    const batchInviteEmails = new Set(inviteCreateEmails());
    const batchEnrollUserIds = enrollmentCreateUserIds();

    // Index-aligned outcome buckets must match exactly, in order, on both paths.
    expect(normalizeOutcomes(batchOutcomes)).toEqual(normalizeOutcomes(seqOutcomes));
    expect(batchOutcomes.map((o) => o.status)).toEqual([
      'invited',
      'enrolled',
      'failed',
      'invited',
      'failed',
      'failed',
    ]);
    expect(seqOutcomes.map((o) => o.status)).toEqual(batchOutcomes.map((o) => o.status));

    // Same DB writes as the sequential reference (prisma is a static import — reliable under concurrency).
    expect(batchInviteEmails).toEqual(seqInviteEmails);
    expect(batchEnrollUserIds.length).toBe(seqEnrollUserIds.length);
    expect(batchEnrollUserIds).toEqual(['u-existing']);

    // No enrollment/invite written for the seat-rejected or malformed entries.
    expect([...batchInviteEmails]).not.toContain('rejected@example.com');
    expect([...batchInviteEmails]).not.toContain('not-an-email');
  });

  it('seat-rejected (skipEmails) entries are force-failed with zero DB work on both paths', async () => {
    const entries: StaffEntry[] = [{ email: 'a@example.com' }, { email: 'b@example.com' }];
    const skipEmails = new Set(['a@example.com', 'b@example.com']);

    seedDb();
    const seqOutcomes = await runSequential(entries, CTX, skipEmails);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();

    vi.clearAllMocks();
    seedDb();
    const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, skipEmails);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findMany).not.toHaveBeenCalled();
    expect(prismaMock.invite.findMany).not.toHaveBeenCalled();

    expect(batchOutcomes).toEqual(seqOutcomes);
    expect(batchOutcomes).toEqual([
      { status: 'failed', email: 'a@example.com' },
      { status: 'failed', email: 'b@example.com' },
    ]);
  });

  it('already-enrolled users are skipped identically — no write, no email, on both paths (single entry, no concurrency)', async () => {
    const seed: Seed = {
      users: [existingMember('u-1', 'staff@example.com')],
      enrollments: [{ id: 'enr-existing', userId: 'u-1', courseId: 'course-1' }],
    };
    const entries: StaffEntry[] = [{ email: 'staff@example.com' }];

    seedDb(seed);
    const seqOutcomes = await runSequential(entries, CTX, new Set());
    expect(seqOutcomes).toEqual([{ status: 'alreadyEnrolled', email: 'staff@example.com' }]);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mockSendCourseLaunchEmail.mockResolvedValue(undefined);
    seedDb(seed);
    const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, new Set());
    expect(batchOutcomes).toEqual(seqOutcomes);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
  });

  describe('no-duplicate-email guarantee (single email → single group, no cross-entry concurrency)', () => {
    it('a repeated NEW email in one batch enrolls only once — one enrollment write, one launch email, second occurrence alreadyEnrolled', async () => {
      const seed: Seed = { users: [existingMember('u-1', 'dup@example.com')] };
      const entries: StaffEntry[] = [{ email: 'dup@example.com' }, { email: 'dup@example.com' }];

      seedDb(seed);
      const seqOutcomes = await runSequential(entries, CTX, new Set());
      const seqLaunchCount = mockSendCourseLaunchEmail.mock.calls.length;
      const seqEnrollCreateCount = prismaMock.enrollment.create.mock.calls.length;

      vi.clearAllMocks();
      mockSendCourseLaunchEmail.mockResolvedValue(undefined);
      seedDb(seed);
      const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, new Set());
      const batchLaunchCount = mockSendCourseLaunchEmail.mock.calls.length;
      const batchEnrollCreateCount = prismaMock.enrollment.create.mock.calls.length;

      expect(batchOutcomes.map((o) => o.status)).toEqual(['enrolled', 'alreadyEnrolled']);
      expect(seqOutcomes.map((o) => o.status)).toEqual(['enrolled', 'alreadyEnrolled']);
      expect(batchEnrollCreateCount).toBe(1);
      expect(batchLaunchCount).toBe(1);
      expect(batchEnrollCreateCount).toBe(seqEnrollCreateCount);
      expect(batchLaunchCount).toBe(seqLaunchCount);
    });

    it('a repeated UNKNOWN email in one batch reuses the SAME invite row — no duplicate invite row, both occurrences "invited"', async () => {
      const entries: StaffEntry[] = [
        { email: 'newdup@example.com' },
        { email: 'newdup@example.com' },
      ];

      seedDb();
      const seqOutcomes = await runSequential(entries, CTX, new Set());
      const seqInviteCreateCount = prismaMock.invite.create.mock.calls.length;
      const seqInviteEmailCount = mockSendCourseInviteEmail.mock.calls.length;
      const seqInviteUpdateCount = prismaMock.invite.update.mock.calls.length;

      vi.clearAllMocks();
      mockSendCourseInviteEmail.mockResolvedValue(undefined);
      seedDb();
      const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, new Set());
      const batchInviteCreateCount = prismaMock.invite.create.mock.calls.length;
      const batchInviteEmailCount = mockSendCourseInviteEmail.mock.calls.length;
      const batchInviteUpdateCount = prismaMock.invite.update.mock.calls.length;

      expect(batchOutcomes.map((o) => o.status)).toEqual(['invited', 'invited']);
      expect(seqOutcomes.map((o) => o.status)).toEqual(['invited', 'invited']);
      // Exactly one invite ROW is ever created — the guarantee under test.
      expect(batchInviteCreateCount).toBe(1);
      expect(batchInviteCreateCount).toBe(seqInviteCreateCount);
      // The second occurrence reuses (refreshes) the same row rather than creating a new one.
      expect(batchInviteUpdateCount).toBe(1);
      expect(batchInviteUpdateCount).toBe(seqInviteUpdateCount);
      // The invite email is sent on each occurrence (create AND refresh both notify) —
      // identical on both paths, matching createEnrollmentForUser's own documented behavior.
      expect(batchInviteEmailCount).toBe(seqInviteEmailCount);
      expect(batchInviteEmailCount).toBe(2);
    });
  });

  describe('assignCourseToRole-style batch (no seat rejection, holders only)', () => {
    it('enrolls 50+ role holders identically on both paths, with correct outcome counts', async () => {
      const holderCount = 60;
      const users: FakeUser[] = Array.from({ length: holderCount }, (_, i) =>
        existingMember(`u-${i}`, `holder${i}@example.com`),
      );
      const entries: StaffEntry[] = users.map((u) => ({ email: u.email }));

      seedDb({ users });
      const seqOutcomes = await runSequential(entries, CTX, new Set());
      const seqEnrollCount = prismaMock.enrollment.create.mock.calls.length;

      vi.clearAllMocks();
      mockSendCourseLaunchEmail.mockResolvedValue(undefined);
      seedDb({ users });
      const batchOutcomes = await createEnrollmentsForUsers(entries, CTX, new Set());
      const batchEnrollCount = prismaMock.enrollment.create.mock.calls.length;

      expect(batchOutcomes.every((o) => o.status === 'enrolled')).toBe(true);
      expect(seqOutcomes.every((o) => o.status === 'enrolled')).toBe(true);
      expect(batchOutcomes.length).toBe(holderCount);
      // enrollment.create is the statically-imported prisma mock — reliable under
      // concurrency, unlike the dynamically-imported email mocks (see file header).
      expect(batchEnrollCount).toBe(holderCount);
      expect(batchEnrollCount).toBe(seqEnrollCount);
    });
  });
});

describe('createEnrollmentsForUsers — bounded concurrency', () => {
  it('never runs more than ENROLLMENT_BATCH_CONCURRENCY (10) enrollment writes in flight at once', async () => {
    const holderCount = 25;
    const users: FakeUser[] = Array.from({ length: holderCount }, (_, i) =>
      existingMember(`u-${i}`, `holder${i}@example.com`),
    );
    const entries: StaffEntry[] = users.map((u) => ({ email: u.email }));
    seedDb({ users });

    let inFlight = 0;
    let maxInFlight = 0;
    prismaMock.enrollment.create.mockImplementation(async ({ data }: any) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { id: `enr-${data.userId}`, ...data };
    });

    const outcomes = await createEnrollmentsForUsers(entries, CTX, new Set());

    expect(outcomes.every((o) => o.status === 'enrolled')).toBe(true);
    expect(maxInFlight).toBeGreaterThan(1); // actually concurrent, not accidentally serialized
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });
});

describe('createEnrollmentsForUsers — partial-failure semantics', () => {
  it('a mid-batch launch-email failure does not abort the batch and does not roll back that enrollment', async () => {
    // Single entry — avoids the dynamic-import concurrency caveat (file header);
    // the property under test (email failure isolation) only needs one call.
    const seed: Seed = { users: [existingMember('u-1', 'emailfails@example.com')] };
    const entries: StaffEntry[] = [{ email: 'emailfails@example.com' }];
    seedDb(seed);
    mockSendCourseLaunchEmail.mockRejectedValue(new Error('SMTP down'));

    const outcomes = await createEnrollmentsForUsers(entries, CTX, new Set());

    expect(outcomes).toEqual([
      { status: 'enrolled', email: 'emailfails@example.com', userId: 'u-1', enrollmentId: 'enr-1' },
    ]);
    expect(prismaMock.enrollment.create).toHaveBeenCalledTimes(1);
  });

  it('a createNotification throw aborts the run on BOTH paths (rejects, does not resolve a partial result)', async () => {
    const users: FakeUser[] = [
      existingMember('u-1', 'ok1@example.com'),
      existingMember('u-2', 'boom@example.com'),
      existingMember('u-3', 'ok2@example.com'),
    ];
    const entries: StaffEntry[] = users.map((u) => ({ email: u.email }));

    seedDb({ users });
    mockCreateNotification.mockImplementation(async (data: any) => {
      if (data.userId === 'u-2') throw new Error('notification service down');
    });
    await expect(runSequential(entries, CTX, new Set())).rejects.toThrow(
      'notification service down',
    );

    vi.clearAllMocks();
    mockSendCourseLaunchEmail.mockResolvedValue(undefined);
    seedDb({ users });
    mockCreateNotification.mockImplementation(async (data: any) => {
      if (data.userId === 'u-2') throw new Error('notification service down');
    });
    await expect(createEnrollmentsForUsers(entries, CTX, new Set())).rejects.toThrow(
      'notification service down',
    );
  });

  // ---------------------------------------------------------------------
  // DIVERGENCE FINDING: the sequential path aborts the loop entirely on a
  // throw — no entry after the failing one is ever attempted. The batched
  // path's workers are dispatched concurrently (bounded by
  // ENROLLMENT_BATCH_CONCURRENCY = 10), so for a batch whose group count is
  // <= 10, EVERY group is already in flight before the failing group's
  // error is even observed — later entries can complete (and commit an
  // enrollment) despite the batch ultimately rejecting. Asserted here via
  // prisma.enrollment.create (statically imported — reliable under
  // concurrency; see the file header for why email-mock assertions are
  // avoided in multi-group-concurrent scenarios).
  // ---------------------------------------------------------------------
  it('DIVERGENCE: entries positioned AFTER the failing one are committed on the batched path but never attempted on the sequential path', async () => {
    const users: FakeUser[] = [
      existingMember('u-1', 'before@example.com'),
      existingMember('u-2', 'fails@example.com'),
      existingMember('u-3', 'after1@example.com'),
      existingMember('u-4', 'after2@example.com'),
    ];
    const entries: StaffEntry[] = users.map((u) => ({ email: u.email }));

    // Sequential reference run.
    seedDb({ users });
    mockCreateNotification.mockImplementation(async (data: any) => {
      if (data.userId === 'u-2') throw new Error('notify down');
    });
    await expect(runSequential(entries, CTX, new Set())).rejects.toThrow('notify down');
    const seqEnrolledUserIds = enrollmentCreateUserIds();

    // Batched run, identical input/fixtures.
    vi.clearAllMocks();
    mockSendCourseLaunchEmail.mockResolvedValue(undefined);
    seedDb({ users });
    mockCreateNotification.mockImplementation(async (data: any) => {
      if (data.userId === 'u-2') throw new Error('notify down');
    });
    await expect(createEnrollmentsForUsers(entries, CTX, new Set())).rejects.toThrow('notify down');
    const batchEnrolledUserIds = enrollmentCreateUserIds();

    // Sequential: the failing entry's OWN enrollment write already happened
    // (createNotification runs AFTER enrollment.create — see create.ts), so
    // u-2 is committed too; but u-3/u-4 are never touched (no user lookup, no
    // enrollment write) — the loop stops the instant u-2 throws.
    expect(seqEnrolledUserIds).toEqual(['u-1', 'u-2']);

    // Batched: u-3 and u-4 are dispatched to their own concurrent workers
    // BEFORE u-2's error is observed, and are not cancelled — they commit
    // their enrollments too, even though the overall batch call rejects. This
    // is a real, blocking behavioral divergence from the sequential path's
    // "nothing after the failure point is ever touched" guarantee — see the
    // test file header / PR-7 report for the full writeup.
    expect(batchEnrolledUserIds.sort()).toEqual(['u-1', 'u-2', 'u-3', 'u-4']);
  });
});
