/**
 * The export job's stamped facility scope must be the SAME verdict the
 * status and download routes re-derive when they release the artifact.
 *
 * This route used to call a local `resolveAuditFacilityIds` that widened
 * supervisors to the whole org, while `[jobId]/status` and `[jobId]/download`
 * re-derived the narrow `resolveDataFacilityIds` and refuse any job whose
 * recorded scope theirs does not contain. A supervisor could therefore start an
 * export and then get 403 on both polling and downloading it — the job was
 * unreachable by the only person allowed to ask for it.
 *
 * `resolveDataFacilityIds` runs for real here (only the facility lookup under it
 * is mocked), so these assert on the shipped verdict rather than a double.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthorize,
  mockOrgFindUnique,
  mockOrgUserFindFirst,
  mockJobCreate,
  mockQueueAdd,
  mockListAccessibleFacilities,
  mockOrgCourseWhere,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
  mockJobCreate: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockOrgCourseWhere: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: { findUnique: mockOrgFindUnique },
    organizationUser: { findFirst: mockOrgUserFindFirst },
    course: { findFirst: vi.fn() },
    job: { create: mockJobCreate },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/rbac/authorize', () => ({ authorize: mockAuthorize }));
vi.mock('@/lib/queue/auditor-export-queue', () => ({
  auditorExportQueue: { add: mockQueueAdd },
}));
vi.mock('@/lib/queue/auditor-export-worker', () => ({ getExportWorker: vi.fn() }));
vi.mock('@/lib/course/org-scope', () => ({ orgCourseWhere: mockOrgCourseWhere }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { resolveDataFacilityIds } from '@/lib/facility/staff-where';
import type { Role } from '@/types/next-auth';
import { POST } from './route';

const ORG = 'org-1';
const ANNEX = 'facility-annex';

function req(body: Record<string, unknown> = {}) {
  return { json: async () => body } as never;
}

function setCaller(role: string) {
  mockAuthorize.mockResolvedValue({
    ok: true,
    ctx: { userId: 'u1', role, organizationId: ORG, organizationUserId: 'ou1' },
  });
}

/** The session shape the status/download routes rebuild before re-deriving scope. */
const callerSession = (role: Role) => ({
  user: { id: 'u1', role, organizationId: ORG, organizationUserId: 'ou1' },
});

const stampedFacilityIds = () => mockJobCreate.mock.calls[0][0].data.payload.facilityIds;

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgFindUnique.mockResolvedValue({ hasAuditorAccess: true });
  mockJobCreate.mockResolvedValue({ id: 'job-1' });
  mockQueueAdd.mockResolvedValue(undefined);
  mockOrgCourseWhere.mockResolvedValue({ creator: { organizationId: ORG } });
  mockListAccessibleFacilities.mockResolvedValue([{ id: ANNEX }]);
});

describe('POST /api/auditor/export/start — stamped facility scope', () => {
  it('stamps a supervisor’s own facilities, not org-wide', async () => {
    setCaller('supervisor');

    const res = await POST(req({ scope: 'org' }));

    expect(res.status).toBe(200);
    expect(stampedFacilityIds()).toEqual([ANNEX]);
  });

  it('stamps exactly what the status/download routes will re-derive for the same caller', async () => {
    setCaller('supervisor');

    await POST(req({ scope: 'org' }));

    // The releasability check in [jobId]/status and [jobId]/download requires
    // the stamped scope to be an array contained by this value. `null` — what
    // the old widened resolver produced — fails that check outright.
    const reDerived = await resolveDataFacilityIds(callerSession('supervisor'));
    expect(stampedFacilityIds()).toEqual(reDerived);
    expect(Array.isArray(reDerived)).toBe(true);
    expect((reDerived as string[]).every((id) => stampedFacilityIds().includes(id))).toBe(true);
  });

  it('passes the identical scope to the queue and to the DB row, so the worker cannot drift', async () => {
    setCaller('supervisor');

    await POST(req({ scope: 'org' }));

    expect(mockQueueAdd.mock.calls[0][1].facilityIds).toEqual(stampedFacilityIds());
  });

  it('still stamps null for an org-wide role', async () => {
    setCaller('hr');

    await POST(req({ scope: 'org' }));

    expect(stampedFacilityIds()).toBeNull();
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
  });

  it('fails closed when a facility-bound caller has no assignments', async () => {
    setCaller('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    const res = await POST(req({ scope: 'org' }));

    expect(res.status).toBe(403);
    expect(mockJobCreate).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('404s a staff-scoped export aimed at someone outside the caller’s facilities', async () => {
    setCaller('supervisor');
    // The narrowed lookup finds nothing for an out-of-facility target.
    mockOrgUserFindFirst.mockResolvedValue(null);

    const res = await POST(req({ scope: 'staff', scopeId: 'ou-riverside' }));

    expect(res.status).toBe(404);
    expect(mockOrgUserFindFirst.mock.calls[0][0].where.facilities).toEqual({
      some: { facilityId: { in: [ANNEX] }, active: true },
    });
    expect(mockJobCreate).not.toHaveBeenCalled();
  });
});
