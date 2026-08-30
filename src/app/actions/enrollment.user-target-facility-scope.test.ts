/**
 * Facility-scope wiring for the USER-target assignment path (enrollUsers).
 *
 * `getAvailableUsers` narrows the assign page's picker to the caller's
 * facilities, but the "Specific people" control accepts a free-text email, so
 * that narrowing was advisory: a facility-bound supervisor could enroll any
 * member of the organisation simply by typing their address.
 *
 * The failure was silent in both directions. Reads ARE correctly scoped, so the
 * assigner's own "Enrolled Staff" view never showed the enrollment they had just
 * created, and the target's own supervisor saw an enrollment nobody in their
 * facility had made. Nothing surfaced the crossing to either side — which is
 * why this needs a test rather than a code-review habit.
 *
 * `assignCourseToRoles` already narrowed the ROLE path
 * (enrollment.role-target-facility-scope.test.ts). This is its sibling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockCourseFindUnique,
  mockOrgUserFindMany,
  mockOrganizationFindUnique,
  mockListAccessibleFacilities,
  mockCreateEnrollmentForUser,
  mockCreateEnrollmentsForUsers,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCourseFindUnique: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockOrganizationFindUnique: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockCreateEnrollmentForUser: vi.fn(),
  mockCreateEnrollmentsForUsers: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    course: { findUnique: mockCourseFindUnique },
    user: { findUnique: vi.fn() },
    organizationUser: { findMany: mockOrgUserFindMany, findFirst: vi.fn(), count: vi.fn() },
    orgCourseOffering: { findUnique: vi.fn(), upsert: vi.fn() },
    courseAssignment: { create: vi.fn().mockResolvedValue({ id: 'a-1' }), findFirst: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
    enrollment: { findFirst: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn().mockResolvedValue(null) },
    organizationUserFacility: { findFirst: vi.fn().mockResolvedValue(null) },
    reminderLog: { create: vi.fn() },
    invite: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn() },
    organization: { findUnique: mockOrganizationFindUnique },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./notifications', () => ({
  createNotification: vi.fn(),
  notifyOrganizationAdmins: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: vi.fn(),
  sendCourseLaunchEmail: vi.fn(),
}));
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
  createEnrollmentsForUsers: mockCreateEnrollmentsForUsers,
}));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { enrollUsers } from './enrollment';

const ORG_ID = 'org-1';
const ADMIN_ORG_USER_ID = 'ou-admin-1';
const F1 = 'facility-1';
const F2 = 'facility-2';
const IN_FACILITY = 'f1.worker@example.com';
const OTHER_FACILITY = 'f2.worker@example.com';

function setSession(role: string) {
  mockAuth.mockResolvedValue({
    user: {
      id: 'user-1',
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role,
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

/** Both targets are real members; one sits in the caller's facility, one does not. */
function membersAcrossBothFacilities() {
  mockOrgUserFindMany.mockResolvedValue([
    { user: { email: IN_FACILITY }, facilities: [{ facilityId: F1 }] },
    { user: { email: OTHER_FACILITY }, facilities: [{ facilityId: F2 }] },
  ]);
}

const ENTRIES = [{ email: IN_FACILITY }, { email: OTHER_FACILITY }];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENROLLMENT_BATCH_ENABLED;
  setSession('supervisor');
  mockCourseFindUnique.mockResolvedValue({
    id: 'course-1',
    title: 'Infection Control',
    createdByOrgUserId: ADMIN_ORG_USER_ID,
    isGlobal: false,
    status: 'published',
    reviewRequired: false,
  });
  // No `plan` on the subscription ⇒ getSeatUsage resolves staffMax null and the
  // seat gate is a no-op, isolating the facility gate under test.
  mockOrganizationFindUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  });
  mockOrgUserFindMany.mockResolvedValue([]);
  mockListAccessibleFacilities.mockResolvedValue([{ id: F1 }]);
  mockCreateEnrollmentForUser.mockImplementation(async (entry: { email: string }) => ({
    status: 'enrolled',
    email: entry.email.toLowerCase(),
    userId: 'u-1',
    enrollmentId: 'e-1',
  }));
});

describe('enrollUsers — facility scope (sequential path)', () => {
  it('refuses a target outside the caller facilities, even when named by email', async () => {
    membersAcrossBothFacilities();

    const result = await enrollUsers('course-1', ENTRIES);

    expect(result.failed).toContain(OTHER_FACILITY);
    expect(result.success).not.toContain(OTHER_FACILITY);

    const enrolled = mockCreateEnrollmentForUser.mock.calls.map((c) => c[0].email);
    expect(enrolled).not.toContain(OTHER_FACILITY);
  });

  it('still enrolls the target inside the caller facilities — the gate narrows, it does not block', async () => {
    membersAcrossBothFacilities();

    const result = await enrollUsers('course-1', ENTRIES);

    expect(result.success).toContain(IN_FACILITY);
    const enrolled = mockCreateEnrollmentForUser.mock.calls.map((c) => c[0].email);
    expect(enrolled).toContain(IN_FACILITY);
  });

  it('an ORG-WIDE role is not narrowed at all — no facility query, both targets enrolled', async () => {
    setSession('owner');
    membersAcrossBothFacilities();

    const result = await enrollUsers('course-1', ENTRIES);

    expect(result.success).toEqual(expect.arrayContaining([IN_FACILITY, OTHER_FACILITY]));
    expect(result.failed).toHaveLength(0);
  });

  it('a facility-bound caller with NO accessible facilities enrolls nobody — fail closed', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);
    membersAcrossBothFacilities();

    const result = await enrollUsers('course-1', ENTRIES);

    expect(result.success).toHaveLength(0);
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('leaves an unknown email to the invite path rather than rejecting it as out-of-facility', async () => {
    // No matching member rows: the address belongs to nobody in the org yet, so
    // the facility gate must not claim it — `invite.create` governs that case.
    mockOrgUserFindMany.mockResolvedValue([]);

    await enrollUsers('course-1', [{ email: 'stranger@example.com' }]);

    const enrolled = mockCreateEnrollmentForUser.mock.calls.map((c) => c[0].email);
    expect(enrolled).toContain('stranger@example.com');
  });
});

describe('enrollUsers — facility scope (batched path)', () => {
  it('passes the same rejection set to the batched path, so the kill-switch cannot reopen the hole', async () => {
    process.env.ENROLLMENT_BATCH_ENABLED = 'true';
    membersAcrossBothFacilities();
    mockCreateEnrollmentsForUsers.mockResolvedValue([
      { status: 'enrolled', email: IN_FACILITY, userId: 'u-1', enrollmentId: 'e-1' },
      { status: 'failed', email: OTHER_FACILITY },
    ]);

    await enrollUsers('course-1', ENTRIES);

    const skipEmails = mockCreateEnrollmentsForUsers.mock.calls[0][2] as ReadonlySet<string>;
    expect(skipEmails.has(OTHER_FACILITY)).toBe(true);
    expect(skipEmails.has(IN_FACILITY)).toBe(false);
  });
});
