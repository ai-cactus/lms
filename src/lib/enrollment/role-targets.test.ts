/**
 * Tests for the live role-target auto-enroll hook.
 *
 * Multi-role targeting moved the match from the single `targetRole` column to the
 * `targetRoles` list, so the assertions here pin the query shape (a `has` on the
 * membership's role) and the deadline context each enrollment is created with.
 * Per-user enrollment creation is delegated to createEnrollmentForUser (mocked —
 * covered by ./create.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMembershipFindFirst, mockAssignmentFindMany, mockCreateEnrollmentForUser } = vi.hoisted(
  () => ({
    mockMembershipFindFirst: vi.fn(),
    mockAssignmentFindMany: vi.fn(),
    mockCreateEnrollmentForUser: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organizationUser: { findFirst: mockMembershipFindFirst },
    courseAssignment: { findMany: mockAssignmentFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./create', () => ({ createEnrollmentForUser: mockCreateEnrollmentForUser }));

import { enrollUserForRoleTargets } from './role-targets';

const ORG_ID = 'org-1';
const ORG_USER_ID = 'ou-nurse-1';
const ROLE_JOINED_AT = new Date('2026-01-10T00:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockMembershipFindFirst.mockResolvedValue({
    role: 'nurse',
    roleAssignedAt: ROLE_JOINED_AT,
    user: { email: 'nurse1@test.com' },
    organization: { name: 'Acme Corp' },
    facilities: [{ facilityId: 'facility-1' }],
  });
  mockAssignmentFindMany.mockResolvedValue([]);
  mockCreateEnrollmentForUser.mockResolvedValue({
    status: 'enrolled',
    email: 'nurse1@test.com',
    userId: 'user-1',
    enrollmentId: 'enrollment-1',
  });
});

describe('enrollUserForRoleTargets', () => {
  it('matches assignments whose targetRoles contain the membership role, in the caller org only', async () => {
    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockAssignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID, targetRoles: { has: 'nurse' } },
      }),
    );
  });

  it('enrolls the user in a multi-role assignment that lists their role alongside others', async () => {
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'assignment-1',
        courseId: 'course-1',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: false,
        facilityIds: [],
        course: { title: 'Infection Control' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({
        courseId: 'course-1',
        assignmentId: 'assignment-1',
        // The window counts from the role-join date when there is no hard deadline.
        scheduleAt: ROLE_JOINED_AT,
        assignmentDueAt: null,
        assignmentWindowDays: 21,
      }),
    );
  });

  it('auto-enrolls off a row written before multi-role targeting (backfilled targetRoles)', async () => {
    // A pre-migration row: `targetRole: 'nurse'` copied into `targetRoles` by the
    // backfill, which is what the `has` query matches on.
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'legacy-assignment',
        courseId: 'legacy-course',
        dueAt: null,
        dueWindowDays: null,
        facilityScoped: false,
        facilityIds: [],
        course: { title: 'HIPAA Basics' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ courseId: 'legacy-course', assignmentId: 'legacy-assignment' }),
    );
  });

  it('carries an absolute assignment deadline to a late joiner instead of a computed window', async () => {
    const dueAt = new Date('2026-03-01T17:00:00.000Z');
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'assignment-2',
        courseId: 'course-2',
        dueAt,
        dueWindowDays: 30,
        facilityScoped: false,
        facilityIds: [],
        course: { title: 'Annual Compliance' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ assignmentDueAt: dueAt }),
    );
  });

  it('does nothing when the membership is not in the given organization', async () => {
    mockMembershipFindFirst.mockResolvedValue(null);

    await enrollUserForRoleTargets(ORG_USER_ID, 'other-org');

    expect(mockAssignmentFindMany).not.toHaveBeenCalled();
    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('never throws — an auto-enroll failure must not abort the caller', async () => {
    mockAssignmentFindMany.mockRejectedValue(new Error('db down'));

    await expect(enrollUserForRoleTargets(ORG_USER_ID, ORG_ID)).resolves.toBeUndefined();
  });
});

// The assignment reaches a new holder only inside the facility scope its
// author had. Without this, a facility-bound supervisor's assignment would
// keep auto-enrolling new joiners at facilities they cannot see, growing the
// assignment's reach past the assigner's own over time.
describe('enrollUserForRoleTargets — facility-scoped assignments', () => {
  it('enrolls a new holder whose facility intersects the assignment scope', async () => {
    mockMembershipFindFirst.mockResolvedValue({
      role: 'nurse',
      roleAssignedAt: ROLE_JOINED_AT,
      user: { email: 'nurse1@test.com' },
      organization: { name: 'Acme Corp' },
      facilities: [{ facilityId: 'facility-1' }],
    });
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'scoped-assignment',
        courseId: 'course-scoped',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: true,
        facilityIds: ['facility-1', 'facility-2'],
        course: { title: 'Infection Control' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ courseId: 'course-scoped', assignmentId: 'scoped-assignment' }),
    );
  });

  it('skips a new holder whose facility is OUTSIDE the assignment scope', async () => {
    mockMembershipFindFirst.mockResolvedValue({
      role: 'nurse',
      roleAssignedAt: ROLE_JOINED_AT,
      user: { email: 'nurse1@test.com' },
      organization: { name: 'Acme Corp' },
      facilities: [{ facilityId: 'facility-9' }],
    });
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'scoped-assignment',
        courseId: 'course-scoped',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: true,
        facilityIds: ['facility-1'],
        course: { title: 'Infection Control' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: skips a holder with NO facility assignments at all against a scoped assignment', async () => {
    mockMembershipFindFirst.mockResolvedValue({
      role: 'nurse',
      roleAssignedAt: ROLE_JOINED_AT,
      user: { email: 'nurse1@test.com' },
      organization: { name: 'Acme Corp' },
      facilities: [],
    });
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'scoped-assignment',
        courseId: 'course-scoped',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: true,
        facilityIds: ['facility-1'],
        course: { title: 'Infection Control' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).not.toHaveBeenCalled();
  });

  it('an org-wide assignment (facilityScoped:false) still enrolls a holder regardless of their facility', async () => {
    mockMembershipFindFirst.mockResolvedValue({
      role: 'nurse',
      roleAssignedAt: ROLE_JOINED_AT,
      user: { email: 'nurse1@test.com' },
      organization: { name: 'Acme Corp' },
      facilities: [{ facilityId: 'facility-9' }],
    });
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'org-wide-assignment',
        courseId: 'course-org-wide',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: false,
        facilityIds: [],
        course: { title: 'Infection Control' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ courseId: 'course-org-wide' }),
    );
  });

  it('one scoped assignment matching and one not: only the matching one enrolls', async () => {
    mockMembershipFindFirst.mockResolvedValue({
      role: 'nurse',
      roleAssignedAt: ROLE_JOINED_AT,
      user: { email: 'nurse1@test.com' },
      organization: { name: 'Acme Corp' },
      facilities: [{ facilityId: 'facility-1' }],
    });
    mockAssignmentFindMany.mockResolvedValue([
      {
        id: 'matching-assignment',
        courseId: 'course-match',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: true,
        facilityIds: ['facility-1'],
        course: { title: 'Matches' },
      },
      {
        id: 'non-matching-assignment',
        courseId: 'course-no-match',
        dueAt: null,
        dueWindowDays: 21,
        facilityScoped: true,
        facilityIds: ['facility-2'],
        course: { title: 'Does not match' },
      },
    ]);

    await enrollUserForRoleTargets(ORG_USER_ID, ORG_ID);

    expect(mockCreateEnrollmentForUser).toHaveBeenCalledExactlyOnceWith(
      { email: 'nurse1@test.com' },
      expect.objectContaining({ courseId: 'course-match' }),
    );
  });
});
