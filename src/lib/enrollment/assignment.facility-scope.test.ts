/**
 * upsertCourseAssignment's `facilityScope` parameter, direct (not only via the
 * assignCourseToRoles action, see enrollment.role-target-facility-scope.test.ts).
 *
 * `undefined` has a load-bearing, different meaning here than in
 * `targetRoles`: it means "leave an existing row's recorded scope untouched"
 * (an individual re-assignment via enrollUsers must not restate the role
 * targeting's reach), whereas `null` means "record org-wide". Confusing the
 * two would either wipe a supervisor's narrowed assignment back to org-wide
 * on every plain staff re-assignment, or silently narrow an org-wide
 * assignment nobody asked to scope.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  scheduleAt: null,
  dueAt: null,
  dueWindowDays: null,
  remindersEnabled: true,
  renewalCycle: 'none' as const,
  stageRows: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAssignmentCreate.mockResolvedValue({ id: 'assignment-new' });
  mockAssignmentUpdate.mockResolvedValue({ id: 'assignment-existing' });
});

describe('upsertCourseAssignment — facilityScope on CREATE', () => {
  it('facilityScope: null persists as org-wide (facilityScoped:false)', async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    await upsertCourseAssignment({ ...BASE_PARAMS, facilityScope: null });

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(false);
    expect(data.facilityIds).toEqual([]);
  });

  it('facilityScope: [ids] persists as narrowed (facilityScoped:true)', async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    await upsertCourseAssignment({ ...BASE_PARAMS, facilityScope: ['fac-1', 'fac-2'] });

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(true);
    expect(data.facilityIds).toEqual(['fac-1', 'fac-2']);
  });

  it('BACKFILL: facilityScope omitted (undefined) writes NEITHER column — the row falls back to the schema default (org-wide)', async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    await upsertCourseAssignment(BASE_PARAMS);

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('facilityScoped');
    expect(data).not.toHaveProperty('facilityIds');
  });

  it('facilityScope: [] (narrowed to nobody) persists as facilityScoped:true with an empty facilityIds — distinct from omitting it', async () => {
    mockAssignmentFindFirst.mockResolvedValue(null);

    await upsertCourseAssignment({ ...BASE_PARAMS, facilityScope: [] });

    const data = mockAssignmentCreate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(true);
    expect(data.facilityIds).toEqual([]);
  });
});

describe('upsertCourseAssignment — facilityScope on UPDATE (re-assignment)', () => {
  beforeEach(() => {
    mockAssignmentFindFirst.mockResolvedValue({ id: 'assignment-existing' });
  });

  it("THE LOAD-BEARING CASE: facilityScope omitted leaves the existing row's scope columns untouched — an individual re-assignment must not restate the role-targeting scope", async () => {
    await upsertCourseAssignment(BASE_PARAMS);

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('facilityScoped');
    expect(data).not.toHaveProperty('facilityIds');
  });

  it("facilityScope: [ids] overwrites the existing row's scope to the new narrowing", async () => {
    await upsertCourseAssignment({ ...BASE_PARAMS, facilityScope: ['fac-9'] });

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(true);
    expect(data.facilityIds).toEqual(['fac-9']);
  });

  it('facilityScope: null explicitly widens an existing row back to org-wide', async () => {
    await upsertCourseAssignment({ ...BASE_PARAMS, facilityScope: null });

    const data = mockAssignmentUpdate.mock.calls[0][0].data;
    expect(data.facilityScoped).toBe(false);
    expect(data.facilityIds).toEqual([]);
  });

  it('settingsMode: "preserve" returns the existing id and never touches the scope columns at all', async () => {
    await upsertCourseAssignment({
      ...BASE_PARAMS,
      facilityScope: ['fac-1'],
      settingsMode: 'preserve',
    });

    expect(mockAssignmentUpdate).not.toHaveBeenCalled();
    expect(mockAssignmentCreate).not.toHaveBeenCalled();
  });
});
