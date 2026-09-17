/**
 * The audit-report catalogue predicate.
 *
 * It exists so the on-screen catalogue and the generated export cannot filter
 * differently — that divergence is the screen-disagrees-with-PDF defect #632
 * closed. Each surface asserts the predicate it passes to Prisma
 * (auditor.d01-scope.test.ts, auditor-export-worker.archive-scope.test.ts);
 * these tests pin the predicate itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOfferingFindMany } = vi.hoisted(() => ({ mockOfferingFindMany: vi.fn() }));

vi.mock('@/lib/prisma', () => {
  const prisma = { orgCourseOffering: { findMany: mockOfferingFindMany } };
  return { prisma, default: prisma };
});

import { auditorCatalogueWhere } from './catalogue-scope';

beforeEach(() => {
  vi.clearAllMocks();
  mockOfferingFindMany.mockResolvedValue([]);
});

describe('auditorCatalogueWhere', () => {
  it('excludes drafts, superseding the every-status ruling', async () => {
    await expect(auditorCatalogueWhere('org-a')).resolves.toEqual({
      organizationId: 'org-a',
      status: { not: 'draft' },
    });
  });

  it('excludes `draft` only — a retired course is still evidence', async () => {
    const where = await auditorCatalogueWhere('org-a');

    // Narrowing to `{ equals: 'published' }` would drop every retired course
    // from the report, which the maintainer explicitly ruled against.
    expect(where.status).toEqual({ not: 'draft' });
  });

  it('keeps the adopted-course union intact alongside the status filter', async () => {
    mockOfferingFindMany.mockResolvedValue([{ courseId: 'adopted-1' }]);

    // Prisma ANDs the sibling `status` with the `OR`, so this reads "an org
    // course that is also not a draft", not "an org course or any non-draft".
    await expect(auditorCatalogueWhere('org-a')).resolves.toEqual({
      OR: [{ organizationId: 'org-a' }, { id: { in: ['adopted-1'] } }],
      status: { not: 'draft' },
    });
  });

  it('carries no archivedAt filter — archival is not a status (Q24)', async () => {
    const where = await auditorCatalogueWhere('org-a');

    expect(where).not.toHaveProperty('archivedAt');
  });
});
