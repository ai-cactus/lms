/**
 * Unit tests for src/lib/reminders/compliance.ts
 *
 * getOverdueComplianceForOrg uses `new Date()` internally for the query filter
 * and for daysOverdue math, so vi.useFakeTimers() pins the clock.
 *
 * Covers: correct row mapping (all fields), daysOverdue calculation (tz-aware),
 * hardEscalationCount (≥7 days), descending sort by daysOverdue, manager name
 * propagation, workerName fallback to email, empty result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock references ──────────────────────────────────────────────────

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    enrollment: { findMany: vi.fn() },
  };
  return { prismaMock };
});

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { getOverdueComplianceForOrg } from './compliance';

// ─── Fixed clock ──────────────────────────────────────────────────────────────

// noon UTC June 15 = 08:00 EDT in America/New_York (local date "2024-06-15")
const NOW = new Date('2024-06-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnrollment(
  id: string,
  dueAtIso: string,
  opts: {
    status?: string;
    fullName?: string | null;
    managerName?: string | null;
    timezone?: string | null;
  } = {},
) {
  const {
    status = 'in_progress',
    fullName = `Worker ${id}`,
    managerName = null,
    timezone = 'America/New_York',
  } = opts;
  return {
    id,
    userId: `user-${id}`,
    courseId: `course-${id}`,
    dueAt: new Date(dueAtIso),
    status,
    course: { title: `Course ${id}` },
    user: {
      email: `worker-${id}@test.com`,
      profile: fullName !== null ? { fullName } : null,
      manager: managerName !== null ? { profile: { fullName: managerName } } : null,
      organization: timezone !== null ? { timezone } : null,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getOverdueComplianceForOrg', () => {
  it('returns an empty summary when prisma returns no overdue enrollments', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const result = await getOverdueComplianceForOrg('org-1');

    expect(result.overdueCount).toBe(0);
    expect(result.hardEscalationCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('maps a single enrollment to a ComplianceRow with all expected fields', async () => {
    // dueAt = June 5 → daysOverdue = 10 (June 15 - June 5)
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { managerName: 'Alice Manager' }),
    ]);

    const result = await getOverdueComplianceForOrg('org-1');

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.enrollmentId).toBe('e1');
    expect(row.userId).toBe('user-e1');
    expect(row.workerName).toBe('Worker e1');
    expect(row.workerEmail).toBe('worker-e1@test.com');
    expect(row.courseId).toBe('course-e1');
    expect(row.courseTitle).toBe('Course e1');
    expect(row.dueAt).toEqual(new Date('2024-06-05T12:00:00Z'));
    expect(row.daysOverdue).toBe(10);
    expect(row.status).toBe('in_progress');
    expect(row.managerName).toBe('Alice Manager');
  });

  it('computes daysOverdue correctly using timezone-aware day math', async () => {
    // dueAt = June 12 → daysOverdue = 3
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-12T12:00:00Z'),
    ]);

    const { rows } = await getOverdueComplianceForOrg('org-1');
    expect(rows[0].daysOverdue).toBe(3);
  });

  it('counts hardEscalationCount for enrollments that are ≥7 days overdue', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z'), // 10 days overdue → hard
      makeEnrollment('e2', '2024-06-08T12:00:00Z'), // 7 days overdue → hard (≥ 7)
      makeEnrollment('e3', '2024-06-12T12:00:00Z'), // 3 days overdue → not hard
    ]);

    const result = await getOverdueComplianceForOrg('org-1');

    expect(result.overdueCount).toBe(3);
    expect(result.hardEscalationCount).toBe(2);
  });

  it('sorts rows by daysOverdue descending (most-overdue first)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-12T12:00:00Z'), // 3 days overdue
      makeEnrollment('e2', '2024-06-05T12:00:00Z'), // 10 days overdue
      makeEnrollment('e3', '2024-06-08T12:00:00Z'), // 7 days overdue
    ]);

    const { rows } = await getOverdueComplianceForOrg('org-1');

    expect(rows.map((r) => r.enrollmentId)).toEqual(['e2', 'e3', 'e1']);
    expect(rows[0].daysOverdue).toBeGreaterThanOrEqual(rows[1].daysOverdue);
    expect(rows[1].daysOverdue).toBeGreaterThanOrEqual(rows[2].daysOverdue);
  });

  it('falls back to worker email when profile fullName is null', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { fullName: null }),
    ]);

    const { rows } = await getOverdueComplianceForOrg('org-1');
    expect(rows[0].workerName).toBe('worker-e1@test.com');
  });

  it('sets managerName to null when worker has no manager', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { managerName: null }),
    ]);

    const { rows } = await getOverdueComplianceForOrg('org-1');
    expect(rows[0].managerName).toBeNull();
  });

  it('uses DEFAULT_TZ when organization timezone is null', async () => {
    // dueAt = June 5 noon UTC; with DEFAULT_TZ (America/New_York) daysOverdue = 10
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { timezone: null }),
    ]);

    const { rows } = await getOverdueComplianceForOrg('org-1');
    // Should still compute 10 days using the fallback timezone
    expect(rows[0].daysOverdue).toBe(10);
  });

  it('queries with the correct orgId filter (passes it to prisma)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await getOverdueComplianceForOrg('org-42');

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { is: { organizationId: 'org-42' } },
        }),
      }),
    );
  });
});
