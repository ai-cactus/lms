/**
 * Facility scope for the COURSES-LIST assign modal (assignCourseToUsers).
 *
 * The sibling of enrollment.user-target-facility-scope.test.ts, and the same
 * hole: this action names its targets by free-text email, so narrowing the
 * pickers around it is advisory only — a facility-bound supervisor could assign
 * a course to any member of the organisation by typing their address. PR #552
 * routed every other caller-named write through the shared target-scope helper
 * and missed this one.
 *
 * The refusal is RETURNED, never thrown: a thrown Server Action message reaches
 * the browser redacted (React error #441), so the modal would show a blank
 * failure instead of naming the addresses it skipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockAdminAuth,
  mockWorkerAuth,
  mockListAccessibleFacilities,
  mockCreateEnrollmentForUser,
  mockCreateEnrollmentsForUsers,
} = vi.hoisted(() => {
  const prismaMock = {
    course: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationUser: { findMany: vi.fn() },
    courseAssignment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    assignmentReminderStage: { upsert: vi.fn() },
  };
  return {
    prismaMock,
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockListAccessibleFacilities: vi.fn(),
    mockCreateEnrollmentForUser: vi.fn(),
    mockCreateEnrollmentsForUsers: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/reminders/sweep', () => ({ resolveOnCompletion: vi.fn() }));
vi.mock('@/lib/enrollment/create', () => ({
  createEnrollmentForUser: mockCreateEnrollmentForUser,
  createEnrollmentsForUsers: mockCreateEnrollmentsForUsers,
}));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { assignCourseToUsers } from './course';

const ADMIN_ID = 'admin-001';
const ADMIN_ORG_USER_ID = 'ou-admin-001';
const ORG_ID = 'org-001';
const COURSE_ID = 'course-001';
const F1 = 'facility-1';
const F2 = 'facility-2';
const IN_FACILITY = 'f1.worker@acme.com';
const OTHER_FACILITY = 'f2.worker@acme.com';

function sessionFor(role: string) {
  mockAdminAuth.mockResolvedValue({
    user: {
      id: ADMIN_ID,
      organizationUserId: ADMIN_ORG_USER_ID,
      organizationId: ORG_ID,
      role,
    },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

/**
 * Both members are real and both match by email; only their facility differs.
 * The action reads the roster once for the id/email pairs and the target-scope
 * helper reads it again for the facility memberships, so the mock answers by
 * the shape each caller selected rather than by call order.
 */
function membersAcrossBothFacilities() {
  const roster = [
    { id: 'ou-f1', email: IN_FACILITY, facilityId: F1 },
    { id: 'ou-f2', email: OTHER_FACILITY, facilityId: F2 },
  ];

  prismaMock.organizationUser.findMany.mockImplementation(
    (args: { where: { user: { email: { in: string[] } } }; select?: { facilities?: unknown } }) => {
      const requested = new Set(args.where.user.email.in);
      const rows = roster.filter((member) => requested.has(member.email));
      return Promise.resolve(
        args.select?.facilities
          ? rows.map((member) => ({
              user: { email: member.email },
              facilities: [{ facilityId: member.facilityId }],
            }))
          : rows.map((member) => ({ id: member.id, user: { email: member.email } })),
      );
    },
  );
}

const BOTH = [IN_FACILITY, OTHER_FACILITY];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENROLLMENT_BATCH_ENABLED;
  sessionFor('supervisor');
  prismaMock.course.findUnique.mockResolvedValue({
    title: 'Infection Control',
    creator: { organizationId: ORG_ID },
  });
  prismaMock.organization.findUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: { status: 'active', pausedAt: null },
  });
  prismaMock.courseAssignment.findFirst.mockResolvedValue(null);
  prismaMock.courseAssignment.create.mockResolvedValue({ id: 'assignment-001' });
  mockListAccessibleFacilities.mockResolvedValue([{ id: F1 }]);
  mockCreateEnrollmentForUser.mockImplementation((entry: { email: string }) =>
    Promise.resolve({
      status: 'enrolled' as const,
      email: entry.email,
      userId: `u-${entry.email}`,
      enrollmentId: `e-${entry.email}`,
    }),
  );
  membersAcrossBothFacilities();
});

describe('assignCourseToUsers — facility scope', () => {
  it('refuses a target outside the caller facilities, even when named by email', async () => {
    const result = await assignCourseToUsers(COURSE_ID, BOTH);

    expect(result.success).toBe(true);
    expect(result.outOfScope).toEqual([OTHER_FACILITY]);

    const enrolled = mockCreateEnrollmentForUser.mock.calls.map((call) => call[0].email);
    expect(enrolled).not.toContain(OTHER_FACILITY);
  });

  it('reports the refusal instead of throwing, so the modal can name the address', async () => {
    await expect(assignCourseToUsers(COURSE_ID, BOTH)).resolves.toMatchObject({
      success: true,
      outOfScope: [OTHER_FACILITY],
    });
  });

  it('still assigns the target inside the caller facilities — the gate narrows, it does not block', async () => {
    const result = await assignCourseToUsers(COURSE_ID, BOTH);

    expect(result).toEqual({
      success: true,
      count: 1,
      notFound: [],
      outOfScope: [OTHER_FACILITY],
    });

    const enrolled = mockCreateEnrollmentForUser.mock.calls.map((call) => call[0].email);
    expect(enrolled).toEqual([IN_FACILITY]);
  });

  it('an ORG-WIDE role is not narrowed at all — both targets assigned', async () => {
    sessionFor('admin');

    const result = await assignCourseToUsers(COURSE_ID, BOTH);

    expect(result).toEqual({ success: true, count: 2, notFound: [], outOfScope: [] });
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
  });

  it('refuses by return with the facility message when EVERY target is out of scope', async () => {
    const result = await assignCourseToUsers(COURSE_ID, [OTHER_FACILITY]);

    expect(result).toEqual({
      success: false,
      message: 'You can only assign courses to staff in your own facilities.',
      notFound: [],
      outOfScope: [OTHER_FACILITY],
    });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('a facility-bound caller with NO accessible facilities assigns nobody — fail closed', async () => {
    mockListAccessibleFacilities.mockResolvedValue([]);

    const result = await assignCourseToUsers(COURSE_ID, BOTH);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ outOfScope: BOTH });
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('keeps notFound and outOfScope disjoint — an unknown address is not claimed by the facility gate', async () => {
    const result = await assignCourseToUsers(COURSE_ID, [...BOTH, 'ghost@acme.com']);

    expect(result).toEqual({
      success: true,
      count: 1,
      notFound: ['ghost@acme.com'],
      outOfScope: [OTHER_FACILITY],
    });
  });

  it('passes the same rejection set to the batched path, so the kill-switch cannot reopen the hole', async () => {
    process.env.ENROLLMENT_BATCH_ENABLED = 'true';
    mockCreateEnrollmentsForUsers.mockResolvedValue([
      { status: 'enrolled', email: IN_FACILITY, userId: 'u-1', enrollmentId: 'e-1' },
    ]);

    const result = await assignCourseToUsers(COURSE_ID, BOTH);

    const entries = mockCreateEnrollmentsForUsers.mock.calls[0][0] as { email: string }[];
    expect(entries.map((entry) => entry.email)).toEqual([IN_FACILITY]);
    expect(result.outOfScope).toEqual([OTHER_FACILITY]);
  });
});
