/**
 * `Course` has no `organizationId`, so "the org's courses" is a union of two
 * unrelated links: authorship (via the creator's membership) and adoption (via
 * `OrgCourseOffering`, where the author is a DIFFERENT tenant). Every audit
 * query spelled out only the first half and silently lost the whole video
 * catalogue; these pin the union so a third copy cannot drift again.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { orgCourseOffering: { findMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));

import { listAdoptedCourseIds, orgCourseWhere } from './org-scope';

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
      OR: [{ creator: { organizationId: 'org-a' } }, { id: { in: ['adopted-1'] } }],
    });
  });

  it('omits the empty OR branch when nothing is adopted', async () => {
    await expect(orgCourseWhere('org-a')).resolves.toEqual({
      creator: { organizationId: 'org-a' },
    });
  });

  it('never widens past the organisation — an org with no courses matches nothing extra', async () => {
    prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);

    const where = await orgCourseWhere('org-a');

    expect(JSON.stringify(where)).not.toContain('org-b');
    expect(where).toHaveProperty('creator.organizationId', 'org-a');
  });
});
