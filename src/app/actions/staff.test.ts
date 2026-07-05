/**
 * THER-007 regression tests for resendInvite:
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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockSendInviteEmail } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    invite: { findUnique: vi.fn(), update: vi.fn() },
    enrollment: { findUnique: vi.fn() },
  },
  mockSendInviteEmail: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// resendInvite dynamically imports '@/lib/email' — mock the module path.
vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));

import { resendInvite, getStaffDetails, getEnrollmentQuizResult } from './staff';

const ADMIN = { role: 'admin', organizationId: 'org-1' };
const PENDING_INVITE = {
  organizationId: 'org-1',
  email: 'newstaff@example.com',
  role: 'worker',
  status: 'pending',
  organization: { name: 'Acme Co' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  prismaMock.user.findUnique.mockResolvedValue(ADMIN);
  prismaMock.invite.findUnique.mockResolvedValue(PENDING_INVITE);
  prismaMock.invite.update.mockResolvedValue({});
  mockSendInviteEmail.mockResolvedValue(undefined);
});

describe('resendInvite — authorization', () => {
  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'worker', organizationId: 'org-1' });

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
      'worker',
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
  const ADMIN_ORG_A = { id: 'admin-a', role: 'admin', organizationId: 'org-a' };

  function makeTargetUser(organizationId: string) {
    return {
      id: 'target-1',
      email: 'target@example.com',
      role: 'worker',
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
      user: { id: 'worker-1', role: 'worker', organizationId: 'org-a' },
    });

    await expect(getStaffDetails('target-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects (throws) when the admin session has no organizationId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin-a', role: 'admin', organizationId: null } });

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
  const ADMIN_ORG_A = { id: 'admin-a', role: 'admin', organizationId: 'org-a' };
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
      user: { id: 'worker-1', role: 'worker', organizationId: 'org-a' },
    });

    await expect(getEnrollmentQuizResult(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });
});
