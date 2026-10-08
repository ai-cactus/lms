/**
 * Q-35: a learner's retry request reaches only the admins who can see that
 * learner — the org-wide admin tier plus facility-bound admins rostered where
 * the learner is rostered NOW — narrowed to those who can open the staff
 * profile (Q-25) and minus per-admin opt-outs. Each delivery leg honours the
 * org's own switch for its channel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { can } from '@/lib/rbac/permissions';
import { ADMIN_ROLES, dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { permissionForLink } from './link-audience';

interface Member {
  id: string;
  role: string;
  organizationId: string;
  active: boolean;
  email: string;
  facilities: { facilityId: string; active: boolean }[];
}

const { prismaMock, mockWarn, mockError, mockIsChannelEnabled, mockCreateNotification } =
  vi.hoisted(() => ({
    prismaMock: {
      organizationUser: { findMany: vi.fn() },
      organizationUserFacility: { findMany: vi.fn() },
      notificationPreference: { findMany: vi.fn() },
    },
    mockWarn: vi.fn(),
    mockError: vi.fn(),
    mockIsChannelEnabled: vi.fn(),
    mockCreateNotification: vi.fn(),
  }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mockWarn, error: mockError, debug: vi.fn() },
  maskEmail: () => '[masked]',
}));
vi.mock('@/lib/notifications/category-preferences', () => ({
  isNotificationChannelEnabled: mockIsChannelEnabled,
}));
vi.mock('@/lib/notifications/create', () => ({ createNotification: mockCreateNotification }));

import { notifyLearnerAdmins, resolveLearnerAdminAudience } from './facility-audience';

const ORG = 'org-1';
const LEARNER = 'ou-learner';
const LINK = `/dashboard/staff/${LEARNER}?retake=enr-1`;

function member(
  id: string,
  role: string,
  facilityIds: string[] = [],
  overrides: Partial<Member> = {},
): Member {
  return {
    id,
    role,
    organizationId: ORG,
    active: true,
    email: `${id}@acme.test`,
    facilities: facilityIds.map((facilityId) => ({ facilityId, active: true })),
    ...overrides,
  };
}

let roster: Member[];

type MemberWhere = {
  organizationId: string;
  active: boolean;
  id: { not: string };
  role: { in: string[] };
  OR: [
    { role: { in: string[] } },
    { facilities: { some: { active: boolean; facilityId: { in: string[] } } } },
  ];
};

/** Evaluates the audience query the way Postgres would, over `roster`. */
function evaluateMemberQuery({ where }: { where: MemberWhere }) {
  const [orgWide, facilityMatch] = where.OR;
  const wanted = new Set(facilityMatch.facilities.some.facilityId.in);
  return roster
    .filter(
      (m) =>
        m.organizationId === where.organizationId &&
        m.active === where.active &&
        m.id !== where.id.not &&
        where.role.in.includes(m.role) &&
        (orgWide.role.in.includes(m.role) ||
          m.facilities.some((f) => f.active && wanted.has(f.facilityId))),
    )
    .map((m) => ({ id: m.id, role: m.role, user: { email: m.email } }));
}

function learnerRosteredAt(...facilityIds: string[]) {
  prismaMock.organizationUserFacility.findMany.mockResolvedValue(
    facilityIds.map((facilityId) => ({ facilityId })),
  );
}

const notice = {
  type: 'COURSE_RETRY_REQUESTED',
  title: 'Retry Requested',
  message: 'Ada asked for a retake of Safety.',
  linkUrl: LINK,
  metadata: { enrollmentId: 'enr-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  roster = [
    member('owner-1', 'owner'),
    member('hr-1', 'hr'),
    member('cd-1', 'clinical_director'),
    member('fin-1', 'finance'),
    member('sup-north', 'supervisor', ['fac-north']),
    member('sup-south', 'supervisor', ['fac-south']),
    member('sup-was-north', 'supervisor', [], {
      facilities: [{ facilityId: 'fac-north', active: false }],
    }),
    member('owner-other-org', 'owner', [], { organizationId: 'org-2' }),
    member('owner-inactive', 'owner', [], { active: false }),
    member('nurse-north', 'nurse', ['fac-north']),
    member(LEARNER, 'nurse', ['fac-north']),
  ];
  prismaMock.organizationUser.findMany.mockImplementation(evaluateMemberQuery);
  prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  learnerRosteredAt('fac-north');
  mockIsChannelEnabled.mockResolvedValue(true);
  mockCreateNotification.mockResolvedValue(undefined);
});

describe('resolveLearnerAdminAudience', () => {
  it("reaches org-wide admins holding user.read plus supervisors rostered at the learner's facility", async () => {
    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience.map((a) => a.organizationUserId).sort()).toEqual([
      'hr-1',
      'owner-1',
      'sup-north',
    ]);
  });

  it('follows the learner to their current facility, never the one they left', async () => {
    learnerRosteredAt('fac-south');

    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience.map((a) => a.organizationUserId).sort()).toEqual([
      'hr-1',
      'owner-1',
      'sup-south',
    ]);
  });

  it('reaches only the org-wide tier for a learner with no active facility', async () => {
    learnerRosteredAt();

    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience.map((a) => a.organizationUserId).sort()).toEqual(['hr-1', 'owner-1']);
  });

  it('never makes the learner their own audience', async () => {
    roster = [member(LEARNER, 'owner'), member('owner-1', 'owner')];

    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience.map((a) => a.organizationUserId)).toEqual(['owner-1']);
  });

  it('drops admins who opted out of the type', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([
      { organizationUserId: 'sup-north' },
    ]);

    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience.map((a) => a.organizationUserId).sort()).toEqual(['hr-1', 'owner-1']);
    expect(prismaMock.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'COURSE_RETRY_REQUESTED', enabled: false }),
      }),
    );
  });

  it('warns and returns nobody when no admin who can see the learner can open the link', async () => {
    roster = [
      member('cd-1', 'clinical_director'),
      member('sup-south', 'supervisor', ['fac-south']),
    ];

    const audience = await resolveLearnerAdminAudience(ORG, LEARNER, notice);

    expect(audience).toEqual([]);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COURSE_RETRY_REQUESTED', requiredPermission: 'user.read' }),
    );
    expect(prismaMock.notificationPreference.findMany).not.toHaveBeenCalled();
  });
});

describe('notifyLearnerAdmins', () => {
  const sendEmail = vi.fn();

  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ success: true });
  });

  it('writes one in-app notice and sends one email per recipient when both switches are on', async () => {
    await notifyLearnerAdmins(ORG, LEARNER, notice, sendEmail);

    expect(mockCreateNotification.mock.calls.map(([n]) => n.organizationUserId).sort()).toEqual([
      'hr-1',
      'owner-1',
      'sup-north',
    ]);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COURSE_RETRY_REQUESTED', linkUrl: LINK }),
    );
    expect(sendEmail.mock.calls.map(([r]) => r.email).sort()).toEqual([
      'hr-1@acme.test',
      'owner-1@acme.test',
      'sup-north@acme.test',
    ]);
  });

  it("sends no email while the org's Training email switch is off, but still notifies in-app", async () => {
    mockIsChannelEnabled.mockImplementation(async (_org, _type, channel) => channel !== 'email');

    await notifyLearnerAdmins(ORG, LEARNER, notice, sendEmail);

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalledTimes(3);
  });

  it('writes no in-app notice while the in-app switch is off, but still emails', async () => {
    mockIsChannelEnabled.mockImplementation(async (_org, _type, channel) => channel !== 'inApp');

    await notifyLearnerAdmins(ORG, LEARNER, notice, sendEmail);

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it('emails nobody who opted out of the type', async () => {
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ organizationUserId: 'hr-1' }]);

    await notifyLearnerAdmins(ORG, LEARNER, notice, sendEmail);

    expect(sendEmail.mock.calls.map(([r]) => r.organizationUserId)).not.toContain('hr-1');
  });

  it('logs a failed or throwing send without throwing itself', async () => {
    sendEmail.mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('smtp'));

    await expect(notifyLearnerAdmins(ORG, LEARNER, notice, sendEmail)).resolves.toBeUndefined();
    expect(mockError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mockError.mock.calls)).not.toContain('@acme.test');
  });
});

describe('retry-request audience invariants', () => {
  it('the deep link narrows the audience to user.read holders', () => {
    expect(permissionForLink(LINK)).toBe('user.read');
  });

  // Everyone who receives a retry request must be able to act on it with
  // assignRetake, which gates on enrollment.create.
  it('every admin-tier holder of user.read also holds enrollment.create', () => {
    const readers = ADMIN_ROLES.filter((role) => can(dbRoleToRoleKey(role), 'user.read'));

    expect(readers.length).toBeGreaterThan(0);
    for (const role of readers) {
      expect(can(dbRoleToRoleKey(role), 'enrollment.create')).toBe(true);
    }
  });
});
