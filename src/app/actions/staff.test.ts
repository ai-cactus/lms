/**
 * Unit tests for src/app/actions/staff.ts
 *
 * updateStaffDetails() — Owner role is established ONLY at org creation:
 *   - Promoting a non-owner to owner via updateStaffDetails must be rejected.
 *   - An existing owner keeping their role while editing name/title is allowed.
 *
 * resendInvite() — THER-007 regression tests:
 *   - Authorization: caller must be an authenticated admin who owns the
 *     invite's organization.
 *   - Token + expiry regeneration: a fresh token and a ~7-day expiry window
 *     are written, invalidating any previously-shared (stale) invite link.
 *   - Status reset to 'pending' so an expired invite becomes usable again.
 *   - An already-accepted invite is not silently "resent" — it returns a
 *     distinct, non-throwing error instead.
 *
 * F-009 / F-010 regression tests (org isolation) for getStaffDetails and
 * getEnrollmentQuizResult — see their own describe blocks below.
 *
 * External deps (@/auth, @/lib/prisma, next/cache, @/lib/email) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockUserFindUnique,
  mockUserUpdate,
  mockProfileUpsert,
  mockInviteFindUnique,
  mockInviteUpdate,
  mockRevalidatePath,
  mockSendInviteEmail,
  prismaMock,
} = vi.hoisted(() => {
  const mockUserFindUnique = vi.fn();
  const mockUserUpdate = vi.fn();
  const mockProfileUpsert = vi.fn();
  const mockInviteFindUnique = vi.fn();
  const mockInviteUpdate = vi.fn();
  const mockEnrollmentFindUnique = vi.fn();
  const prismaMock = {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    profile: { upsert: mockProfileUpsert },
    invite: { findUnique: mockInviteFindUnique, update: mockInviteUpdate },
    enrollment: { findUnique: mockEnrollmentFindUnique },
  };
  return {
    mockAuth: vi.fn(),
    mockUserFindUnique,
    mockUserUpdate,
    mockProfileUpsert,
    mockInviteFindUnique,
    mockInviteUpdate,
    mockEnrollmentFindUnique,
    mockRevalidatePath: vi.fn(),
    mockSendInviteEmail: vi.fn(),
    prismaMock,
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
// resendInvite dynamically imports '@/lib/email' — mock the module path.
vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));

import {
  updateStaffDetails,
  resendInvite,
  getStaffDetails,
  getEnrollmentQuizResult,
} from './staff';

// ── Helpers & fixtures ──────────────────────────────────────────────────────────

function makeAdminSession(role = 'owner') {
  return {
    user: { id: 'admin-1', email: 'admin@acme.com', role, organizationId: 'org-1' },
  };
}

const baseData = {
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'nurse' as const,
  jobTitle: 'Nurse',
};

const ADMIN = { role: 'owner', organizationId: 'org-1' };
const PENDING_INVITE = {
  organizationId: 'org-1',
  email: 'newstaff@example.com',
  role: 'nurse',
  status: 'pending',
  organization: { name: 'Acme Co' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockUserFindUnique.mockResolvedValue(ADMIN);
  mockUserUpdate.mockResolvedValue({ id: 'target-1', email: 'target@acme.com' });
  mockProfileUpsert.mockResolvedValue({});
  mockInviteFindUnique.mockResolvedValue(PENDING_INVITE);
  mockInviteUpdate.mockResolvedValue({});
  mockSendInviteEmail.mockResolvedValue(undefined);
});

// ── updateStaffDetails() ────────────────────────────────────────────────────────

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — auth guard', () => {
  it('returns Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when the requester is a worker', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'w-1', email: 'w@a.com', role: 'nurse', organizationId: 'org-1' },
    });
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });
});

// ── Owner-promotion guard ─────────────────────────────────────────────────────

describe('updateStaffDetails() — owner role cannot be granted via edit (one-owner invariant)', () => {
  it('rejects promotion of a worker to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is currently a worker (non-owner)
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'nurse' });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rejects promotion of a supervisor to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'supervisor' });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
  });

  it('allows an existing owner to keep their role while changing name/title', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is already an owner — keeping their role is allowed
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'owner' });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'owner',
      jobTitle: 'CEO',
    });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('updateStaffDetails() — tenant isolation', () => {
  it('rejects when the target user belongs to a different org', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is in a different org
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-OTHER', role: 'nurse' });

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });

  it('rejects when the target user is not found', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue(null);

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — happy path', () => {
  it('updates the user role and profile when all checks pass', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'nurse' });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'supervisor',
      jobTitle: 'Supervisor',
    });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockUserUpdate.mock.calls[0][0].data.role).toBe('supervisor');
    expect(mockProfileUpsert).toHaveBeenCalledOnce();
  });
});

// ── resendInvite() ──────────────────────────────────────────────────────────────

describe('resendInvite — authorization', () => {
  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'nurse', organizationId: 'org-1' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects when the invite belongs to a different organization', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, organizationId: 'org-2' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'Invite does not belong to your organization',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('returns "Invite not found" for an unknown invite id', async () => {
    prismaMock.invite.findUnique.mockResolvedValue(null);

    const result = await resendInvite('bad-id');

    expect(result).toEqual({ success: false, error: 'Invite not found' });
  });
});

describe('resendInvite — already-accepted invite', () => {
  it('does not regenerate the token and returns a clear, non-throwing error', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, status: 'accepted' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'This invite has already been accepted.',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });
});

describe('resendInvite — happy path (token + expiry regeneration, status reset)', () => {
  it('regenerates the token, sets a ~7-day expiry, resets status to pending, and emails the link', async () => {
    const before = Date.now();
    const result = await resendInvite('invite-1');
    const after = Date.now();

    expect(result).toEqual({ success: true });

    const updateCall = prismaMock.invite.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'invite-1' });
    expect(updateCall.data.status).toBe('pending');
    expect(typeof updateCall.data.token).toBe('string');
    expect(updateCall.data.token.length).toBeGreaterThan(0);

    const expiresAt: Date = updateCall.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 5_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 5_000);

    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      'newstaff@example.com',
      expect.stringContaining(`https://app.example.com/join/${updateCall.data.token}`),
      'Acme Co',
      'nurse',
    );
  });

  it('generates a DIFFERENT token each call, invalidating any previously-shared link', async () => {
    await resendInvite('invite-1');
    const firstToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    prismaMock.invite.update.mockClear();
    await resendInvite('invite-1');
    const secondToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    expect(secondToken).not.toBe(firstToken);
  });
});

/**
 * F-009 regression tests for getStaffDetails — cross-tenant isolation.
 *
 * Previously, any authenticated admin could pull another organization's
 * worker details (courses, progress, manager) simply by knowing/guessing a
 * user id, because the lookup never compared the target's organizationId to
 * the caller's. The fix requires the caller be an admin WITH an
 * organizationId and returns null when the target belongs to a different org.
 */
describe('getStaffDetails — org isolation (F-009)', () => {
  const ADMIN_ORG_A = { id: 'admin-a', role: 'owner', organizationId: 'org-a' };

  function makeTargetUser(organizationId: string) {
    return {
      id: 'target-1',
      email: 'target@example.com',
      role: 'nurse',
      organizationId,
      profile: { fullName: 'Target User', avatarUrl: null, jobTitle: 'Nurse' },
      manager: null,
      managerId: null,
      enrollments: [],
    };
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: ADMIN_ORG_A });
  });

  it('returns null when the target user belongs to a different organization (cross-tenant)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeTargetUser('org-b'));

    const result = await getStaffDetails('target-1');

    expect(result).toBeNull();
  });

  it('returns the staff details when the target user belongs to the same organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeTargetUser('org-a'));

    const result = await getStaffDetails('target-1');

    expect(result).not.toBeNull();
    expect(result?.user.email).toBe('target@example.com');
    expect(result?.user.name).toBe('Target User');
  });

  it('rejects (throws) when the caller is not an admin', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: 'org-a' },
    });

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects (throws) when the admin session has no organizationId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-a', role: 'owner', organizationId: null } });

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects (throws) when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * F-010 regression tests for getEnrollmentQuizResult — cross-tenant isolation.
 *
 * Previously an admin could pull the full quiz breakdown (including the
 * correct answers and the worker's name/email) for an enrollment belonging to
 * a completely different organization. The fix returns null when the
 * enrollment's user organizationId doesn't match the caller's.
 */
describe('getEnrollmentQuizResult — org isolation (F-010)', () => {
  const ADMIN_ORG_A = { id: 'admin-a', role: 'owner', organizationId: 'org-a' };
  const ENROLLMENT_ID = 'enrollment-1';

  function makeEnrollment(organizationId: string) {
    return {
      id: ENROLLMENT_ID,
      user: {
        organizationId,
        email: 'worker@example.com',
        profile: { fullName: 'Worker Name' },
        organization: { name: 'Acme Co' },
      },
      course: { title: 'Fire Safety' },
      quizAttempts: [
        {
          score: 50,
          timeTaken: 120,
          attemptCount: 1,
          answers: [{ questionId: 'q1', selectedAnswer: '4', explanation: 'basic math' }],
          quiz: {
            allowedAttempts: 3,
            passingScore: 70,
            questions: [
              {
                id: 'q1',
                text: 'What is 2+2?',
                options: ['3', '4', '5'],
                correctAnswer: '4',
              },
            ],
          },
        },
      ],
    };
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: ADMIN_ORG_A });
  });

  it('returns null for a cross-org enrollment (no correctAnswer or worker identity leaked)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment('org-b'));

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).toBeNull();
  });

  it('returns the quiz result for a same-org enrollment', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment('org-a'));

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).not.toBeNull();
    expect(result?.courseName).toBe('Fire Safety');
    expect(result?.userName).toBe('Worker Name');
    expect(result?.correct).toBe(1);
    expect(result?.wrong).toBe(0);
    expect(result?.questions[0].correctAnswer).toBe('B');
  });

  it('returns null when there are no quiz attempts yet, before the org check runs', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...makeEnrollment('org-a'),
      quizAttempts: [],
    });

    const result = await getEnrollmentQuizResult(ENROLLMENT_ID);

    expect(result).toBeNull();
  });

  it('rejects (throws) when the caller is not an admin', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: 'org-a' },
    });

    await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });
});
