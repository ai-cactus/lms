/**
 * Export-job status: tenant isolation is not facility isolation.
 *
 * Same-org membership alone let one facility's supervisor poll another
 * facility's audit export and watch it progress. No report content leaks —
 * `download` is separately gated — but the existence, timing and completion of
 * another site's audit run is itself scoped information, and it was readable by
 * anyone holding `auditPack.read`.
 *
 * The rule here deliberately mirrors the download route's: a facility-bound
 * caller may only see a job whose recorded scope their own contains. Keeping
 * the two identical is the point — a status endpoint that is laxer than its
 * download endpoint re-opens by inference what the download refuses outright.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthorize, mockJobFindFirst, mockOrgUserFindFirst, mockListAccessibleFacilities } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockJobFindFirst: vi.fn(),
    mockOrgUserFindFirst: vi.fn(),
    mockListAccessibleFacilities: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    job: { findFirst: mockJobFindFirst },
    organizationUser: { findFirst: mockOrgUserFindFirst },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/rbac/authorize', () => ({ authorize: mockAuthorize }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
const F1 = 'facility-1';
const F2 = 'facility-2';

function req() {
  return {} as never;
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

function setJob(userId: string, facilityIds: unknown) {
  mockJobFindFirst.mockResolvedValue({
    id: 'job-1',
    userId,
    status: 'completed',
    payload: facilityIds === undefined ? {} : { facilityIds, progress: 100 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setCaller('supervisor');
  setJob(OTHER, [F1]);
  mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other' }); // same org
  mockListAccessibleFacilities.mockResolvedValue([{ id: F1 }]);
});

describe('GET export job status', () => {
  it('returns the status of the caller own job without any facility check', async () => {
    setJob(CALLER, undefined);

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
  });

  it('refuses a job whose owner is outside the caller organisation', async () => {
    mockOrgUserFindFirst.mockResolvedValue(null);

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });

  it("refuses another facility's job — the regression guard", async () => {
    setJob(OTHER, [F2]);

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });

  it('allows a same-org job whose scope the caller scope contains', async () => {
    setJob(OTHER, [F1]);

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
  });

  it('refuses a job with no recorded scope — unknown is not org-wide', async () => {
    setJob(OTHER, undefined);

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });

  it('leaves an ORG-WIDE caller unnarrowed — they may still poll a peer job', async () => {
    setCaller('owner');
    setJob(OTHER, [F2]);

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
  });
});

/**
 * The client has no other way to tell a report apart from an empty one: the
 * export writes no file, so "completed" alone cannot distinguish "here are your
 * rows" from "nothing matched, and the CSV would be zero bytes".
 */
describe('GET export job status — row count', () => {
  it('surfaces the row count the worker recorded', async () => {
    mockJobFindFirst.mockResolvedValue({
      id: 'job-1',
      userId: CALLER,
      status: 'completed',
      payload: { progress: 100, message: 'No records matched', rowCount: 0 },
    });

    const res = await GET(req(), params);

    await expect(res.json()).resolves.toMatchObject({ status: 'completed', rowCount: 0 });
  });

  it('omits the count for a job that never recorded one', async () => {
    mockJobFindFirst.mockResolvedValue({
      id: 'job-1',
      userId: CALLER,
      status: 'completed',
      payload: { progress: 100, message: 'Report Ready' },
    });

    const res = await GET(req(), params);

    expect(await res.json()).not.toHaveProperty('rowCount');
  });
});

/**
 * RISK-19: owner membership alone is not the organization the job was run for.
 * A user in orgs A and B runs an export in A; an auditor-entitled member of B
 * holding the job id passed the membership check, since the owner IS a member
 * of B. A stamped job is now visible only in its own organization.
 */
describe('GET export job status — organization stamp', () => {
  function setStampedJob(userId: string, organizationId: string | undefined) {
    mockJobFindFirst.mockResolvedValue({
      id: 'job-1',
      userId,
      status: 'completed',
      payload: {
        ...(organizationId === undefined ? {} : { organizationId }),
        facilityIds: null,
        progress: 100,
      },
    });
  }

  beforeEach(() => {
    setCaller('owner');
  });

  it('allows a job stamped with the caller organization', async () => {
    setStampedJob(OTHER, ORG);

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
  });

  it('refuses a job stamped for another organization even though its owner is a member of the caller org', async () => {
    setStampedJob(OTHER, 'org-2');
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other-in-org-1' });

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('refuses the owner too when polling from a different organization', async () => {
    setStampedJob(CALLER, 'org-2');

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });

  it('answers a stamp mismatch exactly as it answers a non-member owner', async () => {
    setStampedJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue(null);
    const nonMember = await GET(req(), params);

    setStampedJob(OTHER, 'org-2');
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other-in-org-1' });
    const mismatch = await GET(req(), params);

    expect(mismatch.status).toBe(nonMember.status);
    expect(await mismatch.json()).toEqual(await nonMember.json());
  });

  it('falls back to owner membership for a legacy job with no stamp — member allowed', async () => {
    setStampedJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-other' });

    const res = await GET(req(), params);

    expect(res.status).toBe(200);
  });

  it('falls back to owner membership for a legacy job with no stamp — non-member refused', async () => {
    setStampedJob(OTHER, undefined);
    mockOrgUserFindFirst.mockResolvedValue(null);

    const res = await GET(req(), params);

    expect(res.status).toBe(403);
  });
});

/**
 * Only export jobs are polled here. Another job type (e.g. a same-org course
 * generation) must read exactly like a missing job.
 */
describe('GET export job status — job type', () => {
  type JobRow = { id: string; type: string; userId: string; status: string; payload: unknown };

  /** Answers the query the way the database would, honouring `where.id` and `where.type`. */
  function storeJob(row: JobRow) {
    mockJobFindFirst.mockImplementation(
      async ({ where }: { where: { id: string; type?: string } }) =>
        where.id === row.id && (where.type === undefined || where.type === row.type) ? row : null,
    );
  }

  it('answers a same-org job of another type exactly as a missing job', async () => {
    setCaller('owner');
    mockJobFindFirst.mockResolvedValue(null);
    const missing = await GET(req(), params);

    storeJob({
      id: 'job-1',
      type: 'GENERATE_V46_COURSE',
      userId: CALLER,
      status: 'completed',
      payload: { organizationId: ORG },
    });
    const otherType = await GET(req(), params);

    expect(otherType.status).toBe(404);
    expect(await otherType.json()).toEqual({ error: 'Job not found' });
    expect(await missing.json()).toEqual({ error: 'Job not found' });
  });
});
