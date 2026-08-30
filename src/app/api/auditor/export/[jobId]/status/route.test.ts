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

const { mockAuthorize, mockJobFindUnique, mockOrgUserFindFirst, mockListAccessibleFacilities } =
  vi.hoisted(() => ({
    mockAuthorize: vi.fn(),
    mockJobFindUnique: vi.fn(),
    mockOrgUserFindFirst: vi.fn(),
    mockListAccessibleFacilities: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    job: { findUnique: mockJobFindUnique },
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
  mockJobFindUnique.mockResolvedValue({
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
