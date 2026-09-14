/**
 * Assign-consolidation Phase 1 — the sink's tri-state contract for the five
 * settings columns (`scheduleAt`, `dueAt`, `dueWindowDays`, `remindersEnabled`,
 * `renewalCycle`) plus `stageRows`.
 *
 * `upsertCourseAssignment` used to write these six unconditionally, so any
 * assign surface that omitted one silently cleared it for the whole
 * organisation (the `CourseAssignment` row is shared, one per
 * `(organizationId, courseId)`). `settingsColumns()` now treats `undefined` as
 * "leave alone" and `null` as "clear", mirroring the already-correct
 * `roleTargetColumns`/`facilityScopeColumns` tri-states — see
 * assignment.facility-scope.test.ts for those two directly.
 *
 * ⚠️ `targetRoles` and `facilityScope` have OPPOSITE `null` meanings
 * (`targetRoles: null` clears; `facilityScope: null` means org-wide) — this
 * file proves neither got collapsed into the other while the settings tri-state
 * was being layered on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultStageRows, type StageRowInput } from './assignment';

const { mockAssignmentFindFirst, mockAssignmentCreate, mockAssignmentUpdate, mockStageUpsert } =
  vi.hoisted(() => ({
    mockAssignmentFindFirst: vi.fn(),
    mockAssignmentCreate: vi.fn(),
    mockAssignmentUpdate: vi.fn(),
    mockStageUpsert: vi.fn(),
  }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    courseAssignment: {
      findFirst: mockAssignmentFindFirst,
      create: mockAssignmentCreate,
      update: mockAssignmentUpdate,
    },
    assignmentReminderStage: { upsert: mockStageUpsert },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { upsertCourseAssignment } from './assignment';

const BASE_PARAMS = {
  organizationId: 'org-1',
  courseId: 'course-1',
  assignedByAdminId: 'admin-1',
};

const RESOLVED_ROW = {
  id: 'assignment-existing',
  dueAt: new Date('2027-06-01'),
  dueWindowDays: 45,
};
const CREATED_ROW = { id: 'assignment-new', dueAt: null, dueWindowDays: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockAssignmentCreate.mockResolvedValue(CREATED_ROW);
  mockAssignmentUpdate.mockResolvedValue(RESOLVED_ROW);
  mockStageUpsert.mockResolvedValue({});
});

describe('upsertCourseAssignment — settings tri-state on UPDATE (re-assignment)', () => {
  beforeEach(() => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'assignment-existing' });
  });

  it("omitting every settings field leaves the existing row's settings columns entirely untouched", async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('scheduleAt');
    expect(data).not.toHaveProperty('dueAt');
    expect(data).not.toHaveProperty('dueWindowDays');
    expect(data).not.toHaveProperty('remindersEnabled');
    expect(data).not.toHaveProperty('renewalCycle');
  });

  it.each([
    ['scheduleAt', new Date('2026-10-01')],
    ['dueAt', new Date('2026-11-01')],
    ['dueWindowDays', 21],
    ['remindersEnabled', false],
    ['renewalCycle', 'annual'],
  ] as const)('an explicit %s value is written to the update payload', async (field, value) => {
    await upsertCourseAssignment({ ...BASE_PARAMS, [field]: value });

    expect(mockAssignmentUpdate.mock.calls[0][0].data).toMatchObject({ [field]: value });
  });

  it.each(['scheduleAt', 'dueAt', 'dueWindowDays'] as const)(
    'an explicit null for %s clears the column — null is a real value here, not "leave alone"',
    async (field) => {
      await upsertCourseAssignment({ ...BASE_PARAMS, [field]: null });

      const data = mockAssignmentUpdate.mock.calls[0][0].data;
      expect(data).toHaveProperty(field);
      expect(data[field]).toBeNull();
    },
  );

  it('omitting stageRows never calls the stage upsert loop — an existing ladder survives untouched', async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    expect(mockStageUpsert).not.toHaveBeenCalled();
  });

  it('a supplied stageRows list upserts exactly those rows, by (assignmentId, stage)', async () => {
    await upsertCourseAssignment({
      ...BASE_PARAMS,
      stageRows: [
        { stage: 'FRIENDLY_REMINDER', offsetDays: -5, enabled: true, channels: ['email'] },
      ],
    });

    expect(mockStageUpsert).toHaveBeenCalledTimes(1);
    expect(mockStageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignmentId_stage: { assignmentId: 'assignment-existing', stage: 'FRIENDLY_REMINDER' },
        },
        update: { offsetDays: -5, enabled: true, channels: ['email'] },
      }),
    );
  });

  it('targetRoles: null CLEARS the role targeting — the opposite meaning to facilityScope: null (org-wide)', async () => {
    await upsertCourseAssignment({ ...BASE_PARAMS, targetRoles: null });

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ targetRole: null, targetRoles: [] });
  });

  it('targetRoles omitted (undefined) leaves an existing role targeting untouched — an individual re-assignment must not clear it', async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('targetRole');
    expect(data).not.toHaveProperty('targetRoles');
  });

  it('targetRoles: null and facilityScope: null in the SAME call produce opposite effects — proves the two tri-states were not collapsed together', async () => {
    await upsertCourseAssignment({ ...BASE_PARAMS, targetRoles: null, facilityScope: null });

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    // targetRoles: null clears the targeting...
    expect(data).toMatchObject({ targetRole: null, targetRoles: [] });
    // ...while facilityScope: null means org-wide, not "cleared to nothing".
    expect(data).toMatchObject({ facilityScoped: false, facilityIds: [] });
  });

  it("returns the RESOLVED row read back from the update, not the caller's input", async () => {
    const result = await upsertCourseAssignment({
      ...BASE_PARAMS,
      dueAt: new Date('2020-01-01'), // deliberately different from RESOLVED_ROW.dueAt
      dueWindowDays: 999,
    });

    expect(result).toEqual(RESOLVED_ROW);
  });
});

describe('upsertCourseAssignment — settings tri-state on CREATE (first assignment)', () => {
  beforeEach(() => {
    mockAssignmentFindFirst.mockResolvedValue(null);
  });

  it('omitting every settings field on create writes none of them — the row takes the column defaults', async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('scheduleAt');
    expect(data).not.toHaveProperty('dueAt');
    expect(data).not.toHaveProperty('dueWindowDays');
    expect(data).not.toHaveProperty('remindersEnabled');
    expect(data).not.toHaveProperty('renewalCycle');
  });

  it('an explicit value on create is still written (create is not "always omit")', async () => {
    await upsertCourseAssignment({ ...BASE_PARAMS, renewalCycle: 'monthly' });

    expect(mockAssignmentCreate.mock.calls[0][0].data).toMatchObject({ renewalCycle: 'monthly' });
  });

  it('omitting stageRows on create seeds the canonical defaultStageRows()', async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    expect(mockAssignmentCreate.mock.calls[0][0].data.reminderStages).toEqual({
      create: defaultStageRows(),
    });
  });

  it('a supplied stageRows list on create is used verbatim, not seeded defaults', async () => {
    const rows: StageRowInput[] = [
      { stage: 'URGENT_REMINDER', offsetDays: -2, enabled: true, channels: ['in_app'] },
    ];

    await upsertCourseAssignment({ ...BASE_PARAMS, stageRows: rows });

    expect(mockAssignmentCreate.mock.calls[0][0].data.reminderStages).toEqual({ create: rows });
  });

  it("returns the row exactly as the create call resolved it, not the caller's input", async () => {
    const result = await upsertCourseAssignment({ ...BASE_PARAMS, dueAt: new Date('2030-01-01') });

    expect(result).toEqual(CREATED_ROW);
  });
});
