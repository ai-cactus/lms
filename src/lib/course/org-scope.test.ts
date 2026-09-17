/**
 * "The org's courses" is a union of two unrelated links: ownership (Q25's
 * `Course.organizationId`) and adoption (via `OrgCourseOffering`, where the
 * course belongs to a DIFFERENT tenant). Every audit query spelled out only the
 * first half and silently lost the whole video catalogue; these pin the union so
 * a third copy cannot drift again.
 *
 * They also pin the predicate SHAPE. Ownership is a column, not a join through
 * the author's membership — a `{ creator: { organizationId } }` here would still
 * return the right rows today while quietly reintroducing the join Q25 removed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { orgCourseOffering: { findMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

import { authoredCourseWhere, listAdoptedCourseIds, orgCourseWhere } from './org-scope';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);
});

describe('listAdoptedCourseIds', () => {
  it('reads only this organisation offering rows', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([
      { courseId: 'c1' },
      { courseId: 'c2' },
    ]);

    await expect(listAdoptedCourseIds('org-a')).resolves.toEqual(['c1', 'c2']);
    expect(prismaMock.orgCourseOffering.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      select: { courseId: true },
    });
  });
});

describe('orgCourseWhere', () => {
  it('unions authored and adopted courses', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    await expect(orgCourseWhere('org-a')).resolves.toEqual({
      OR: [{ organizationId: 'org-a' }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('omits the empty OR branch when nothing is adopted', async () => {
    await expect(orgCourseWhere('org-a')).resolves.toEqual({ organizationId: 'org-a' });
  });

  it('never widens past the organisation — an org with no courses matches nothing extra', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);

    const where = await orgCourseWhere('org-a');

    expect(JSON.stringify(where)).not.toContain('org-b');
    expect(where).toEqual({ organizationId: 'org-a' });
  });
});

// Pure — no Prisma mocking needed. `getCourses`, `getDashboardData` and
// `getGlobalDashboardData` each derive this separately; only `getCourses` was
// ever widened (Team QA #15/C1), which is the bug this fixes for the other two.
describe('authoredCourseWhere', () => {
  it('widens a manager (holds course.read) to every course authored in the organisation', () => {
    expect(
      authoredCourseWhere({
        role: 'owner',
        organizationId: 'org-a',
        organizationUserId: 'ou-1',
      }),
    ).toEqual({ organizationId: 'org-a' });
  });

  it('a facility-bound manager (supervisor, holds course.read) also gets the organisation-wide authored set — courses are global, not facility-scoped', () => {
    expect(
      authoredCourseWhere({
        role: 'supervisor',
        organizationId: 'org-a',
        organizationUserId: 'ou-1',
      }),
    ).toEqual({ organizationId: 'org-a' });
  });

  it('keeps an admin-tier role WITHOUT course.read (finance) scoped to its own authored courses', () => {
    expect(
      authoredCourseWhere({
        role: 'finance',
        organizationId: 'org-a',
        organizationUserId: 'ou-finance-1',
      }),
    ).toEqual({ createdByOrgUserId: 'ou-finance-1' });
  });

  it('keeps a worker role scoped to its own authored courses — `course.read` alone is not enough, only a manager widens', () => {
    // Worker roles hold `course.read` too (to read their own enrolled courses);
    // `isAdminRole` is what stops that from widening this to every worker.
    expect(
      authoredCourseWhere({
        role: 'nurse',
        organizationId: 'org-a',
        organizationUserId: 'ou-nurse-1',
      }),
    ).toEqual({ createdByOrgUserId: 'ou-nurse-1' });
  });

  it('falls back to creator-scope for a manager with no organisation (mid-onboarding) — the caller must still narrow to something', () => {
    expect(
      authoredCourseWhere({ role: 'owner', organizationId: null, organizationUserId: 'ou-1' }),
    ).toEqual({ createdByOrgUserId: 'ou-1' });
  });
});
