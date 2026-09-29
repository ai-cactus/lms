/**
 * getCourseCertificates feeds a course's Certificates tab. Q-29 (ruled
 * 2026-09-29): a departed member's certificate stays listed, labelled "Former
 * staff", while the roster beside it lists current staff only. The facility
 * rule must still never show a supervisor another facility's staff — including
 * departed ones, whose membership is inactive but whose facility rows survive.
 *
 * `certificate.findMany` runs against an in-memory table so the tests assert
 * WHO comes back, not the predicate's spelling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, prismaMock, mockListAccessibleFacilities } = vi.hoisted(
  () => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    prismaMock: { certificate: { findMany: vi.fn() } },
    mockListAccessibleFacilities: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/storage', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/certificate-generator', () => ({ generateCertificatePDF: vi.fn() }));
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getCourseCertificates } from './certificate';

type Member = {
  id: string;
  organizationId: string;
  active: boolean;
  facilityRows: { facilityId: string; active: boolean }[];
  name: string;
};
type CertRow = { id: string; courseId: string; organizationUserId: string };
type MemberWhere = {
  id?: string | { in: string[] };
  organizationId?: string;
  facilities?: { some: { facilityId: { in: string[] }; active: true } };
  OR?: MemberWhere[];
};

const members: Member[] = [
  // At A throughout.
  {
    id: 'ou-ann',
    organizationId: 'org-1',
    active: true,
    facilityRows: [{ facilityId: 'fac-a', active: true }],
    name: 'Ann Active',
  },
  // Left the organisation while at A: membership inactive, facility row intact
  // (removeStaff never touches it).
  {
    id: 'ou-dan',
    organizationId: 'org-1',
    active: false,
    facilityRows: [{ facilityId: 'fac-a', active: true }],
    name: 'Dan Departed',
  },
  // Moved A → B, then left: must count for B only, never for A.
  {
    id: 'ou-tia',
    organizationId: 'org-1',
    active: false,
    facilityRows: [
      { facilityId: 'fac-a', active: false },
      { facilityId: 'fac-b', active: true },
    ],
    name: 'Tia Transferred',
  },
  // Departed with no active facility row at all.
  {
    id: 'ou-nia',
    organizationId: 'org-1',
    active: false,
    facilityRows: [],
    name: 'Nia Nowhere',
  },
  {
    id: 'ou-other-tenant',
    organizationId: 'org-2',
    active: true,
    facilityRows: [{ facilityId: 'fac-a', active: true }],
    name: 'Other Tenant',
  },
  {
    id: 'ou-viewer',
    organizationId: 'org-1',
    active: true,
    facilityRows: [{ facilityId: 'fac-c', active: true }],
    name: 'The Viewer',
  },
];

const certificates: CertRow[] = [
  ...members.map((m) => ({ id: `cert-${m.id}`, courseId: 'course-1', organizationUserId: m.id })),
  { id: 'cert-other-course', courseId: 'course-2', organizationUserId: 'ou-ann' },
];

function matchesMember(where: MemberWhere, member: Member): boolean {
  if (where.OR && !where.OR.some((branch) => matchesMember(branch, member))) return false;
  if (typeof where.id === 'string' && member.id !== where.id) return false;
  if (typeof where.id === 'object' && !where.id.in.includes(member.id)) return false;
  if (where.organizationId !== undefined && member.organizationId !== where.organizationId) {
    return false;
  }
  if (where.facilities) {
    const scoped = where.facilities.some.facilityId.in;
    if (!member.facilityRows.some((row) => row.active && scoped.includes(row.facilityId))) {
      return false;
    }
  }
  return true;
}

function setSession(role: string) {
  mockAdminAuth.mockResolvedValue({
    user: { id: 'u-viewer', role, organizationId: 'org-1', organizationUserId: 'ou-viewer' },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

async function namesFor(role: string, accessibleFacilityIds: string[] = []) {
  setSession(role);
  mockListAccessibleFacilities.mockResolvedValue(accessibleFacilityIds.map((id) => ({ id })));
  const rows = await getCourseCertificates('course-1');
  return rows.map((row) => row.organizationUser.user.fullName).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.certificate.findMany.mockImplementation(
    ({ where }: { where: { courseId: string; organizationUser: MemberWhere } }) =>
      Promise.resolve(
        certificates
          .filter((cert) => cert.courseId === where.courseId)
          .flatMap((cert) => {
            const member = members.find((m) => m.id === cert.organizationUserId)!;
            if (!matchesMember(where.organizationUser, member)) return [];
            return [
              {
                id: cert.id,
                issuedAt: new Date('2026-09-01T00:00:00.000Z'),
                organizationUser: {
                  role: 'nurse',
                  active: member.active,
                  user: { email: `${member.id}@example.com`, fullName: member.name },
                },
              },
            ];
          }),
      ),
  );
});

describe('getCourseCertificates (Q-29)', () => {
  it('an org-wide viewer gets every certificate on the course in the org, departed members included', async () => {
    expect(await namesFor('owner')).toEqual(
      ['Ann Active', 'Dan Departed', 'Nia Nowhere', 'The Viewer', 'Tia Transferred'].sort(),
    );
  });

  it('reports each member’s active flag, so the tab can label former staff', async () => {
    setSession('owner');
    const rows = await getCourseCertificates('course-1');
    const activeByName = Object.fromEntries(
      rows.map((row) => [row.organizationUser.user.fullName, row.organizationUser.active]),
    );

    expect(activeByName['Ann Active']).toBe(true);
    expect(activeByName['Dan Departed']).toBe(false);
  });

  it('a supervisor of A sees A’s current and departed staff, never a member who left A for B', async () => {
    expect(await namesFor('supervisor', ['fac-a'])).toEqual(
      ['Ann Active', 'Dan Departed', 'The Viewer'].sort(),
    );
  });

  it('a supervisor of B sees the member who transferred there before leaving, and nobody from A', async () => {
    expect(await namesFor('supervisor', ['fac-b'])).toEqual(['The Viewer', 'Tia Transferred']);
  });

  it('a departed member with no active facility row is visible to org-wide roles only', async () => {
    expect(await namesFor('supervisor', ['fac-a', 'fac-b'])).not.toContain('Nia Nowhere');
    expect(await namesFor('hr')).toContain('Nia Nowhere');
  });

  it('a facility-bound viewer with no facility sees only their own certificate', async () => {
    expect(await namesFor('supervisor', [])).toEqual(['The Viewer']);
  });

  it('a role without certificate.read (finance) sees only their own certificate', async () => {
    expect(await namesFor('finance')).toEqual(['The Viewer']);
  });

  it('never returns another tenant’s staff or another course’s certificates', async () => {
    setSession('owner');
    const rows = await getCourseCertificates('course-1');

    expect(rows.map((row) => row.id)).not.toContain('cert-ou-other-tenant');
    expect(rows.map((row) => row.id)).not.toContain('cert-other-course');
  });

  it('rejects an unauthenticated caller', async () => {
    mockAdminAuth.mockResolvedValue(null);

    await expect(getCourseCertificates('course-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
  });
});
