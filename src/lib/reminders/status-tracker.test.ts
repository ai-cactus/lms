/**
 * Unit tests for src/lib/reminders/status-tracker.ts
 *
 * getStatusTrackerSummaryForOrg uses `new Date()` internally for the query filter
 * and for daysOverdue math, so vi.useFakeTimers() pins the clock.
 *
 * Covers: correct row mapping (all fields), daysOverdue calculation (tz-aware),
 * hardEscalationCount (≥7 days), descending sort by daysOverdue, manager name
 * propagation, workerName fallback to email, empty result, the shared 14-day
 * due-soon window, and CURRENT-roster facility attribution (never the
 * `Enrollment.facilityId` stamp), and superseded (retaken) enrolments (BUG-38).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    enrollment: { findMany: vi.fn() },
    // buildDashboardScope -> orgCourseWhere -> listAdoptedCourseIds.
    orgCourseOffering: { findMany: vi.fn() },
  };
  return { prismaMock };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { getStatusTrackerSummaryForOrg } from './status-tracker';

// noon UTC June 15 = 08:00 EDT in America/New_York (local date "2024-06-15")
const NOW = new Date('2024-06-15T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prismaMock.orgCourseOffering.findMany.mockResolvedValue([]);
  // The retake lookup (third call) finds none unless a case queues one.
  prismaMock.enrollment.findMany.mockResolvedValue([]);
});

/** The org-wide call every legacy case used; `null` = no facility narrowing. */
function summary(organizationId = 'org-1', dataFacilityIds: string[] | null = null) {
  return getStatusTrackerSummaryForOrg({ organizationId, dataFacilityIds });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function makeEnrollment(
  id: string,
  dueAtIso: string,
  opts: {
    status?: string;
    fullName?: string | null;
    managerName?: string | null;
    timezone?: string | null;
    /** The member's CURRENT active roster rows; defaults to one facility. */
    roster?: { facilityId: string; name: string; timezone: string | null }[];
    assignment?: {
      remindersEnabled?: boolean;
      reminderStages: { stage: string; offsetDays: number; enabled: boolean }[];
    } | null;
    retakeOf?: string | null;
  } = {},
) {
  const {
    status = 'in_progress',
    fullName = `Worker ${id}`,
    managerName = null,
    timezone = 'America/New_York',
    assignment = null,
    retakeOf = null,
  } = opts;
  const roster =
    opts.roster ??
    (timezone !== null ? [{ facilityId: 'fac-home', name: 'Home Facility', timezone }] : []);
  return {
    id,
    organizationUserId: `ou-${id}`,
    courseId: `course-${id}`,
    dueAt: new Date(dueAtIso),
    status,
    retakeOf,
    assignment: assignment && { remindersEnabled: true, ...assignment },
    course: { title: `Course ${id}` },
    organizationUser: {
      user: { email: `worker-${id}@test.com`, fullName },
      manager: managerName !== null ? { user: { fullName: managerName } } : null,
      facilities: roster.map((row) => ({
        facilityId: row.facilityId,
        facility: { name: row.name, timezone: row.timezone },
      })),
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getStatusTrackerSummaryForOrg', () => {
  it('returns an empty summary when prisma returns no overdue enrollments', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const result = await summary();

    expect(result.overdueCount).toBe(0);
    expect(result.hardEscalationCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('maps a single enrollment to a StatusTrackerRow with all expected fields', async () => {
    // dueAt = June 5 → daysOverdue = 10 (June 15 - June 5)
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { managerName: 'Alice Manager' }),
    ]);

    const result = await summary();

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.enrollmentId).toBe('e1');
    expect(row.userId).toBe('ou-e1');
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

    const { rows } = await summary();
    expect(rows[0].daysOverdue).toBe(3);
  });

  it('counts hardEscalationCount for enrollments that are ≥7 days overdue', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z'), // 10 days overdue → hard
      makeEnrollment('e2', '2024-06-08T12:00:00Z'), // 7 days overdue → hard (≥ 7)
      makeEnrollment('e3', '2024-06-12T12:00:00Z'), // 3 days overdue → not hard
    ]);

    const result = await summary();

    expect(result.overdueCount).toBe(3);
    expect(result.hardEscalationCount).toBe(2);
  });

  it('sorts rows by daysOverdue descending (most-overdue first)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-12T12:00:00Z'), // 3 days overdue
      makeEnrollment('e2', '2024-06-05T12:00:00Z'), // 10 days overdue
      makeEnrollment('e3', '2024-06-08T12:00:00Z'), // 7 days overdue
    ]);

    const { rows } = await summary();

    expect(rows.map((r) => r.enrollmentId)).toEqual(['e2', 'e3', 'e1']);
    expect(rows[0].daysOverdue).toBeGreaterThanOrEqual(rows[1].daysOverdue);
    expect(rows[1].daysOverdue).toBeGreaterThanOrEqual(rows[2].daysOverdue);
  });

  it('falls back to worker email when fullName is null', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { fullName: null }),
    ]);

    const { rows } = await summary();
    expect(rows[0].workerName).toBe('worker-e1@test.com');
  });

  it('sets managerName to null when worker has no manager', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { managerName: null }),
    ]);

    const { rows } = await summary();
    expect(rows[0].managerName).toBeNull();
  });

  it('uses DEFAULT_TZ when the worker has no active facility (empty facilities array)', async () => {
    // dueAt = June 5 noon UTC; with DEFAULT_TZ (America/New_York) daysOverdue = 10
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T12:00:00Z', { timezone: null }),
    ]);

    const { rows } = await summary();
    // Should still compute 10 days using the fallback timezone
    expect(rows[0].daysOverdue).toBe(10);
  });

  it('reads timezone from the worker facility, not organization — regression guard', async () => {
    // dueAt = 2024-06-05T05:00:00Z straddles midnight differently per zone:
    //   America/New_York (EDT, UTC-4): 05:00 - 4h = 01:00 June 5  → local date June 5
    //   America/Los_Angeles (PDT, UTC-7): 05:00 - 7h = 22:00 June 4 → local date June 4
    // So the DEFAULT_TZ fallback would compute 10 days overdue, while the real
    // facility timezone (LA) computes 11. If the code regressed to reading
    // organization.timezone (a field removed from the select entirely), the
    // facility value below would never be reached, `?? DEFAULT_TZ` would
    // silently kick in, and this assertion would fail (10 !== 11).
    prismaMock.enrollment.findMany.mockResolvedValue([
      makeEnrollment('e1', '2024-06-05T05:00:00Z', { timezone: 'America/Los_Angeles' }),
    ]);

    const { rows } = await summary();

    expect(rows[0].daysOverdue).toBe(11);

    const call = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(call.select.organizationUser.select.facilities).toEqual({
      where: { active: true },
      orderBy: { joinedAt: 'asc' },
      select: { facilityId: true, facility: { select: { name: true, timezone: true } } },
    });
    expect(call.select.organizationUser.select.organization).toBeUndefined();
  });

  it("queries the dashboards' population: active members of the org, live org courses", async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await summary('org-42');

    const overdueCall = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(overdueCall.where.organizationUser).toEqual({ organizationId: 'org-42', active: true });
    expect(overdueCall.where.course).toEqual({ organizationId: 'org-42', archivedAt: null });
    expect(overdueCall.where.dueAt).toEqual({ not: null, lt: NOW });
    expect(overdueCall.where.status).toEqual({ notIn: ['completed', 'attested'] });
  });
});

// ─── Per-assignment hard-escalation threshold override (Issues #9/#10, TC-022/023) ─

describe('getStatusTrackerSummaryForOrg — per-assignment HARD_ESCALATION override', () => {
  it('flags an overdue row as hard-escalated at offset 0 (immediate escalation override)', async () => {
    // Only 2 days overdue — far short of the default 7-day threshold — but the
    // assignment overrides HARD_ESCALATION to offset 0, so it must still flag.
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-13T12:00:00Z', {
          assignment: {
            reminderStages: [{ stage: 'HARD_ESCALATION', offsetDays: 0, enabled: true }],
          },
        }),
      ])
      .mockResolvedValueOnce([]); // nearDeadline

    const { rows, hardEscalationCount } = await summary();

    expect(rows[0].daysOverdue).toBe(2);
    expect(rows[0].isHardEscalation).toBe(true);
    expect(hardEscalationCount).toBe(1);
  });

  it('never flags a row as hard-escalated when the assignment disables HARD_ESCALATION, however overdue', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-01T12:00:00Z', {
          // 14 days overdue — would be hard-escalated under the default (7d)
          // threshold, but this assignment has explicitly disabled the stage.
          assignment: {
            reminderStages: [{ stage: 'HARD_ESCALATION', offsetDays: 7, enabled: false }],
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    const { rows, hardEscalationCount } = await summary();

    expect(rows[0].daysOverdue).toBe(14);
    expect(rows[0].isHardEscalation).toBe(false);
    expect(hardEscalationCount).toBe(0);
  });

  it('falls back to the system default (7d) threshold when the assignment has no HARD_ESCALATION override row', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-08T12:00:00Z', {
          // 7 days overdue; assignment present but with only an unrelated stage row.
          assignment: {
            reminderStages: [{ stage: 'FRIENDLY_REMINDER', offsetDays: -14, enabled: true }],
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    const { rows } = await summary();

    expect(rows[0].isHardEscalation).toBe(true); // 7 >= default threshold (7)
  });
});

// BUG-63: Track A sends nothing at all for an assignment with reminders switched
// off, so the tracker must not claim it has escalated. It is still overdue.
describe('getStatusTrackerSummaryForOrg — assignment with reminders switched off', () => {
  it('lists and counts the row as overdue but never flags it as a hard escalation', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-01T12:00:00Z', {
          assignment: { remindersEnabled: false, reminderStages: [] },
        }),
      ])
      .mockResolvedValueOnce([]);

    const { rows, overdueCount, hardEscalationCount } = await summary();

    expect(overdueCount).toBe(1);
    expect(rows[0].daysOverdue).toBe(14);
    expect(rows[0].isHardEscalation).toBe(false);
    expect(hardEscalationCount).toBe(0);
  });

  it('ignores an enabled HARD_ESCALATION stage when reminders are switched off', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-13T12:00:00Z', {
          assignment: {
            remindersEnabled: false,
            reminderStages: [{ stage: 'HARD_ESCALATION', offsetDays: 0, enabled: true }],
          },
        }),
      ])
      .mockResolvedValueOnce([]);

    const { rows, hardEscalationCount } = await summary();

    expect(rows[0].isHardEscalation).toBe(false);
    expect(hardEscalationCount).toBe(0);
  });
});

// Q-28: a retake carries no assignment of its own; its threshold is the one
// its original enrolment's assignment sets, exactly as the sweep reads it.
describe('getStatusTrackerSummaryForOrg — retakes inherit the original assignment (Q-28)', () => {
  it('never flags a retake whose original assignment disables HARD_ESCALATION', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        {
          ...makeEnrollment('retake', '2024-06-01T12:00:00Z'),
          organizationUserId: 'ou-learner',
          retakeOf: 'original',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'original',
          organizationUserId: 'ou-learner',
          retakeOf: null,
          assignment: {
            remindersEnabled: true,
            reminderStages: [
              { stage: 'HARD_ESCALATION', offsetDays: 7, enabled: false, channels: [] },
            ],
          },
        },
      ]);

    const { rows, hardEscalationCount } = await summary();

    expect(rows[0].daysOverdue).toBe(14);
    expect(rows[0].isHardEscalation).toBe(false);
    expect(hardEscalationCount).toBe(0);
  });

  it('never flags a retake whose original assignment has reminders switched off (BUG-63)', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        {
          ...makeEnrollment('retake', '2024-06-01T12:00:00Z'),
          organizationUserId: 'ou-learner',
          retakeOf: 'original',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'original',
          organizationUserId: 'ou-learner',
          retakeOf: null,
          assignment: { remindersEnabled: false, reminderStages: [] },
        },
      ]);

    const { rows, overdueCount, hardEscalationCount } = await summary();

    expect(overdueCount).toBe(1);
    expect(rows[0].isHardEscalation).toBe(false);
    expect(hardEscalationCount).toBe(0);
  });

  it('keeps the default threshold for a retake whose original had no assignment', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        {
          ...makeEnrollment('retake', '2024-06-01T12:00:00Z'),
          organizationUserId: 'ou-learner',
          retakeOf: 'original',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'original', organizationUserId: 'ou-learner', retakeOf: null, assignment: null },
      ]);

    const { rows } = await summary();

    expect(rows[0].isHardEscalation).toBe(true);
  });
});

// ─── At-risk / near-deadline view (Issue #9, TC-025) ──────────────────────────

describe('getStatusTrackerSummaryForOrg — nearDeadline (At Risk) view', () => {
  it('returns near-deadline rows separately from overdue rows, sorted soonest-due first', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeEnrollment('overdue-1', '2024-06-05T12:00:00Z')]) // overdue query
      .mockResolvedValueOnce([
        // near-deadline query: due in 5 days, then in 2 days
        makeEnrollment('soon-1', '2024-06-20T12:00:00Z'),
        makeEnrollment('soon-2', '2024-06-17T12:00:00Z'),
      ]);

    const { rows, nearDeadline } = await summary();

    // Disjoint: the overdue row never leaks into nearDeadline and vice versa.
    expect(rows.map((r) => r.enrollmentId)).toEqual(['overdue-1']);
    expect(nearDeadline.rows.map((r) => r.enrollmentId)).toEqual(['soon-2', 'soon-1']);
    expect(nearDeadline.count).toBe(2);
  });

  it('computes daysUntilDue for a near-deadline row (tz-aware)', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEnrollment('soon-1', '2024-06-18T12:00:00Z')]); // 3 days out

    const { nearDeadline } = await summary();

    expect(nearDeadline.rows[0].daysUntilDue).toBe(3);
  });

  // BUG-35: one due-soon window (14 days) shared with the Global View's
  // "Approaching Deadlines".
  it('queries the near-deadline window as [now, now + 14 days] and excludes terminal statuses', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await summary();

    const nearDeadlineCall = prismaMock.enrollment.findMany.mock.calls[1][0];
    expect(nearDeadlineCall.where.dueAt).toEqual({
      gte: NOW,
      lte: new Date('2024-06-29T12:00:00Z'), // NOW + 14 days
    });
    expect(nearDeadlineCall.where.status).toEqual({ notIn: ['completed', 'attested'] });
  });

  it('returns an empty nearDeadline block when there is nothing due soon', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const { nearDeadline } = await summary();

    expect(nearDeadline).toEqual({ count: 0, rows: [] });
  });
});

// Facility scope. BUG-36: narrowing is by the member's CURRENT roster, never
// the `Enrollment.facilityId` stamp, and an empty array must narrow to NOTHING,
// never fall back to org-wide (the `/dashboard/status-tracker` incident).
describe('getStatusTrackerSummaryForOrg — facility scope', () => {
  const ROSTER_NARROWING = (ids: string[]) => ({
    facilities: { some: { facilityId: { in: ids }, active: true } },
  });

  it('applies no facility predicate for an org-wide caller (null)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await summary('org-1', null);

    const overdueCall = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(overdueCall.where.facilityId).toBeUndefined();
    expect(overdueCall.where.organizationUser).not.toHaveProperty('facilities');
  });

  it('narrows by current roster on BOTH the overdue and near-deadline queries', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await summary('org-1', ['fac-1', 'fac-2']);

    for (const [call] of prismaMock.enrollment.findMany.mock.calls) {
      expect(call.where.facilityId).toBeUndefined();
      expect(call.where.organizationUser).toMatchObject(ROSTER_NARROWING(['fac-1', 'fac-2']));
    }
  });

  it('FAIL-CLOSED: an empty array narrows to an impossible `in: []`, never org-wide', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await summary('org-1', []);

    const overdueCall = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(overdueCall.where.organizationUser).toMatchObject(ROSTER_NARROWING([]));
  });

  it("names the member's CURRENT facility, not the one stamped at assignment", async () => {
    // A transferred worker: the row is listed under facility B, where they are
    // rostered today. The stamp (facility A) is not even selected any more.
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-05T12:00:00Z', {
          roster: [{ facilityId: 'fac-b', name: 'Beta', timezone: 'America/New_York' }],
        }),
      ])
      .mockResolvedValueOnce([]);

    const { rows } = await summary('org-1', ['fac-b']);

    expect(rows[0].facilityName).toBe('Beta');
    const call = prismaMock.enrollment.findMany.mock.calls[0][0];
    expect(call.select.facility).toBeUndefined();
  });

  it('names only the in-scope facilities of a two-facility member', async () => {
    const roster = [
      { facilityId: 'fac-a', name: 'Alpha', timezone: 'America/New_York' },
      { facilityId: 'fac-c', name: 'Gamma', timezone: 'America/Los_Angeles' },
    ];
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeEnrollment('e1', '2024-06-05T12:00:00Z', { roster })])
      .mockResolvedValueOnce([]);

    const scoped = await summary('org-1', ['fac-a']);
    expect(scoped.rows[0].facilityName).toBe('Alpha');

    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeEnrollment('e1', '2024-06-05T12:00:00Z', { roster })])
      .mockResolvedValueOnce([]);

    const orgWide = await summary('org-1', null);
    expect(orgWide.rows[0].facilityName).toBe('Alpha, Gamma');
  });

  it('reports no facility name for a member with no roster row', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeEnrollment('e1', '2024-06-05T12:00:00Z', { timezone: null })])
      .mockResolvedValueOnce([]);

    const { rows } = await summary();

    expect(rows[0].facilityName).toBeNull();
  });
});

// BUG-38: `assignRetake` leaves the failed row `locked` for good, so once a
// retake names it in `retakeOf` the old row must stop being reported.
describe('getStatusTrackerSummaryForOrg — superseded (retaken) enrolments', () => {
  it('drops a superseded locked row from the list and from hardEscalationCount', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('locked-old', '2024-06-01T12:00:00Z', { status: 'locked' }), // 14d → hard
        makeEnrollment('stuck', '2024-06-05T12:00:00Z', { status: 'locked' }), // no retake
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ retakeOf: 'locked-old' }]);

    const result = await summary();

    expect(result.rows.map((r) => r.enrollmentId)).toEqual(['stuck']);
    expect(result.overdueCount).toBe(1);
    expect(result.hardEscalationCount).toBe(1);
  });

  it('drops a superseded row from the near-deadline section too', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeEnrollment('soon-old', '2024-06-18T12:00:00Z', { status: 'locked' }),
        makeEnrollment('soon-live', '2024-06-19T12:00:00Z'),
      ])
      .mockResolvedValueOnce([{ retakeOf: 'soon-old' }]);

    const { nearDeadline } = await summary();

    expect(nearDeadline.rows.map((r) => r.enrollmentId)).toEqual(['soon-live']);
    expect(nearDeadline.count).toBe(1);
  });

  it('looks retakes up in the same scope, over the candidate ids only', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([makeEnrollment('e1', '2024-06-05T12:00:00Z')])
      .mockResolvedValueOnce([makeEnrollment('e2', '2024-06-18T12:00:00Z')])
      .mockResolvedValueOnce([]);

    await summary('org-1', ['fac-1']);

    const retakeCall = prismaMock.enrollment.findMany.mock.calls[2][0];
    expect(retakeCall.where.retakeOf).toEqual({ in: ['e1', 'e2'] });
    expect(retakeCall.where.organizationUser).toMatchObject({
      organizationId: 'org-1',
      active: true,
      facilities: { some: { facilityId: { in: ['fac-1'] }, active: true } },
    });
    expect(retakeCall.where.course).toEqual({ organizationId: 'org-1', archivedAt: null });
  });

  it('skips the retake lookup when nothing is overdue or due soon', async () => {
    prismaMock.enrollment.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await summary();

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledTimes(2);
  });

  it('drops every earlier link of a retake chain, keeping only the latest', async () => {
    // e-old (locked) is retaken by e-mid (also locked, itself overdue), which
    // is retaken by e-new. The retake-lookup query finds e-mid's row naming
    // e-old AND e-new's row naming e-mid, even though e-new itself is not a
    // candidate (it is not overdue) — retakeOf carries no status filter.
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e-old', '2024-06-01T12:00:00Z', { status: 'locked' }),
        makeEnrollment('e-mid', '2024-06-05T12:00:00Z', { status: 'locked' }),
        makeEnrollment('stuck', '2024-06-08T12:00:00Z', { status: 'locked' }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ retakeOf: 'e-old' }, { retakeOf: 'e-mid' }]);

    const result = await summary();

    expect(result.rows.map((r) => r.enrollmentId)).toEqual(['stuck']);
    expect(result.overdueCount).toBe(1);
  });

  it('issues the retake lookup exactly once for the whole batch, not per candidate row', async () => {
    prismaMock.enrollment.findMany
      .mockResolvedValueOnce([
        makeEnrollment('e1', '2024-06-01T12:00:00Z', { status: 'locked' }),
        makeEnrollment('e2', '2024-06-02T12:00:00Z', { status: 'locked' }),
        makeEnrollment('e3', '2024-06-03T12:00:00Z', { status: 'locked' }),
      ])
      .mockResolvedValueOnce([
        makeEnrollment('e4', '2024-06-20T12:00:00Z'),
        makeEnrollment('e5', '2024-06-21T12:00:00Z'),
      ])
      .mockResolvedValueOnce([]);

    await summary();

    // Overdue + near-deadline + exactly ONE batched retake lookup = 3 calls,
    // regardless of the 5 candidate rows above.
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledTimes(3);
    const retakeCall = prismaMock.enrollment.findMany.mock.calls[2][0];
    expect(retakeCall.where.retakeOf).toEqual({ in: ['e1', 'e2', 'e3', 'e4', 'e5'] });
  });
});
