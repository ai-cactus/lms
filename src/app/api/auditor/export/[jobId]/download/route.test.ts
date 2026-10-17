/**
 * RISK-19: the download released a report whenever the job's OWNER was a member
 * of the caller's organization. A user in orgs A and B who ran a report in A
 * therefore made it downloadable by any auditor-entitled member of B holding the
 * job id. A stamped job is now releasable only in the organization it was run
 * for; a legacy job with no stamp keeps the owner-membership rule, so reports
 * finished before the stamp existed stay downloadable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuthorize,
  mockOrgFindUnique,
  mockJobFindFirst,
  mockOrgUserFindFirst,
  mockListAccessibleFacilities,
  mockAudit,
} = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockOrgFindUnique: vi.fn(),
  mockJobFindFirst: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: { findUnique: mockOrgFindUnique },
    job: { findFirst: mockJobFindFirst },
    organizationUser: { findFirst: mockOrgUserFindFirst },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/rbac/authorize', () => ({ authorize: mockAuthorize }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/audit-reports/flatten', () => ({
  flattenAuditReport: () => [{ staffName: 'Dana Reed', courseTitle: 'Bloodborne Pathogens' }],
}));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { GET } from './route';

const ORG = 'org-1';
const CALLER = 'user-caller';
const OTHER = 'user-other';

function req() {
  return {
    url: 'http://localhost/api/auditor/export/job-1/download?format=csv',
    headers: new Headers(),
  } as never;
}
const params = { params: Promise.resolve({ jobId: 'job-1' }) };

function setCaller(role: string) {
  mockAuthorize.mockResolvedValue({
    ok: true,
    ctx: {
      userId: CALLER,
      email: 'c@example.com',
      role,
      roleKey: role,
      organizationId: ORG,
      organizationUserId: 'ou-caller',
    },
  });
}

function setJob(userId: string, organizationId: string | undefined) {
  mockJobFindFirst.mockResolvedValue({
    id: 'job-1',
    userId,
    status: 'completed',
    payload: {
      ...(organizationId === undefined ? {} : { organizationId }),
      facilityIds: null,
      progress: 100,
    },
    result: { scope: 'org' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCaller('owner');
  mockOrgFindUnique.mockResolvedValue({ name: 'Acme Health', hasAuditorAccess: true });
  mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other' });
  mockListAccessibleFacilities.mockResolvedValue([]);
  mockAudit.mockResolvedValue(undefined);
});

describe('GET export download — organization stamp', () => {
  it('releases a report stamped with the caller organization', async () => {
    setJob(OTHER, ORG);

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });

  it('refuses a report stamped for another organization even though its owner is a member of the caller org', async () => {
    setJob(OTHER, 'org-2');
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other-in-org-1' });

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('refuses the owner too when downloading from a different organization', async () => {
    setJob(CALLER, 'org-2');

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });

  it('answers a stamp mismatch exactly as it answers a non-member owner', async () => {
    setJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue(null);
    const nonMember = await GET(req(), params);

    setJob(OTHER, 'org-2');
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other-in-org-1' });
    const mismatch = await GET(req(), params);

    expect(mismatch.status).toBe(nonMember.status);
    expect(await mismatch.json()).toEqual(await nonMember.json());
  });

  it('falls back to owner membership for a legacy job with no stamp — member allowed', async () => {
    setJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other' });

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
  });

  it('falls back to owner membership for a legacy job with no stamp — non-member refused', async () => {
    setJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue(null);

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('still judges a facility-bound caller by the job facility scope after a matching stamp', async () => {
    setCaller('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'facility-1' }]);
    mockJobFindFirst.mockResolvedValue({
      id: 'job-1',
      userId: OTHER,
      status: 'completed',
      payload: { organizationId: ORG, facilityIds: ['facility-2'], progress: 100 },
      result: { scope: 'org' },
    });

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

/**
 * Only export jobs are downloadable. Another job's `result` (e.g. a same-org
 * generated course) is not an audit report and must read as a missing job.
 */
describe('GET export download — job type', () => {
  type JobRow = {
    id: string;
    type: string;
    userId: string;
    status: string;
    payload: unknown;
    result: unknown;
  };

  /** Answers the query the way the database would, honouring `where.id` and `where.type`. */
  function storeJob(row: JobRow) {
    mockJobFindFirst.mockImplementation(
      async ({ where }: { where: { id: string; type?: string } }) =>
        where.id === row.id && (where.type === undefined || where.type === row.type) ? row : null,
    );
  }

  it('answers a same-org completed job of another type exactly as a missing job', async () => {
    mockJobFindFirst.mockResolvedValue(null);
    const missing = await GET(req(), params);

    storeJob({
      id: 'job-1',
      type: 'GENERATE_V46_COURSE',
      userId: CALLER,
      status: 'completed',
      payload: { organizationId: ORG },
      result: { title: 'Generated course' },
    });
    const otherType = await GET(req(), params);

    expect(otherType.status).toBe(404);
    expect(await otherType.json()).toEqual({ error: 'Job not ready or not found' });
    expect(await missing.json()).toEqual({ error: 'Job not ready or not found' });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
