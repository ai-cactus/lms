/**
 * Phase 5 Priority 1 — the safety property the reminder-ladder consolidation
 * depends on: removing `AssignPublishClient`'s per-stage "Advanced reminder
 * schedule" editor must not wipe an org's custom
 * GRACE_SOFT_ESCALATION/HARD_ESCALATION offsets. Two mechanisms were verified
 * by hand (`reminderDaysToStageRows` emits only `WIZARD_REMINDER_STAGES` — see
 * assignment.reminder-stages.test.ts; `upsertCourseAssignment`'s stage-row loop
 * upserts only the rows it is handed, with no `deleteMany` — see
 * assignment.settings-tri-state.test.ts) but nothing proved the two compose
 * safely end to end.
 *
 * This test proves it AT THE SINK against a stateful fake Prisma double that
 * models real upsert-by-(assignmentId, stage) persistence — not just recording
 * call args — so it actually reads back what a real save would leave in the
 * database, the way the orchestrator's Priority 1 asked for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReminderStage } from '@/generated/prisma/enums';

type StoredStage = { offsetDays: number; enabled: boolean; channels: string[] };

const { store, mockAssignmentFindFirst, mockAssignmentUpdate, mockStageUpsert } = vi.hoisted(() => {
  const store = new Map<ReminderStage, StoredStage>();
  return {
    store,
    mockAssignmentFindFirst: vi.fn(),
    mockAssignmentUpdate: vi.fn(),
    mockStageUpsert: vi.fn(
      async ({
        where,
        update,
      }: {
        where: { assignmentId_stage: { assignmentId: string; stage: ReminderStage } };
        update: StoredStage;
      }) => {
        // Real upsert-by-key semantics: only the addressed stage is touched.
        store.set(where.assignmentId_stage.stage, update);
        return { id: `stage-${where.assignmentId_stage.stage}` };
      },
    ),
  };
});

vi.mock('@/lib/prisma', () => {
  const prisma = {
    courseAssignment: { findFirst: mockAssignmentFindFirst, update: mockAssignmentUpdate },
    assignmentReminderStage: { upsert: mockStageUpsert },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { upsertCourseAssignment, resolveStageRows } from './assignment';

const CUSTOM_GRACE_OFFSET = 10; // the org's custom offset — canonical default is +3.
const CUSTOM_HARD_OFFSET = 12; // canonical default is +7.

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  // Seed the assignment's PRE-EXISTING stored ladder — as if an admin had
  // customized the escalation offsets via the now-removed advanced editor.
  store.set('FRIENDLY_REMINDER', { offsetDays: -14, enabled: true, channels: ['email', 'in_app'] });
  store.set('URGENT_REMINDER', { offsetDays: -3, enabled: true, channels: ['email', 'in_app'] });
  store.set('DAY_OF_DEADLINE', { offsetDays: 0, enabled: true, channels: ['email', 'in_app'] });
  store.set('GRACE_SOFT_ESCALATION', {
    offsetDays: CUSTOM_GRACE_OFFSET,
    enabled: true,
    channels: ['email', 'in_app'],
  });
  store.set('HARD_ESCALATION', {
    offsetDays: CUSTOM_HARD_OFFSET,
    enabled: true,
    channels: ['email', 'in_app'],
  });

  mockAssignmentFindFirst.mockResolvedValue({ id: 'assignment-1' });
  mockAssignmentUpdate.mockResolvedValue({ id: 'assignment-1', dueAt: null, dueWindowDays: null });
});

describe("an assign-page-shaped save (reminderDaysBefore only) never touches the org's custom escalation offsets", () => {
  it('a save carrying only reminderDaysBefore leaves the stored GRACE_SOFT_ESCALATION/HARD_ESCALATION offsets exactly as they were', async () => {
    // Exactly the shape AssignPublishClient submits post-consolidation: no
    // `stages` key at all, only the wizard's "N days before" list.
    const stageRows = resolveStageRows({ reminderDaysBefore: [14, 3, 0] });

    await upsertCourseAssignment({
      organizationId: 'org-1',
      courseId: 'course-1',
      assignedByAdminId: 'admin-1',
      stageRows,
    });

    expect(store.get('GRACE_SOFT_ESCALATION')).toEqual({
      offsetDays: CUSTOM_GRACE_OFFSET,
      enabled: true,
      channels: ['email', 'in_app'],
    });
    expect(store.get('HARD_ESCALATION')).toEqual({
      offsetDays: CUSTOM_HARD_OFFSET,
      enabled: true,
      channels: ['email', 'in_app'],
    });

    // The sink upserted exactly the three wizard stages — never the two
    // escalation stages, and never the fixed admin stage.
    const touchedStages = mockStageUpsert.mock.calls
      .map(([call]) => call.where.assignmentId_stage.stage)
      .sort();
    expect(touchedStages).toEqual(['DAY_OF_DEADLINE', 'FRIENDLY_REMINDER', 'URGENT_REMINDER']);
    expect(mockStageUpsert).toHaveBeenCalledTimes(3);
  });

  it('the pre-deadline stages DO update to the newly submitted cadence — the fix is not "never write", only "never write escalation rows"', async () => {
    const stageRows = resolveStageRows({ reminderDaysBefore: [7] });

    await upsertCourseAssignment({
      organizationId: 'org-1',
      courseId: 'course-1',
      assignedByAdminId: 'admin-1',
      stageRows,
    });

    expect(store.get('FRIENDLY_REMINDER')).toMatchObject({ offsetDays: -7, enabled: true });
    expect(store.get('URGENT_REMINDER')).toMatchObject({ enabled: false });
    expect(store.get('DAY_OF_DEADLINE')).toMatchObject({ enabled: false });
    // Still untouched.
    expect(store.get('GRACE_SOFT_ESCALATION')?.offsetDays).toBe(CUSTOM_GRACE_OFFSET);
    expect(store.get('HARD_ESCALATION')?.offsetDays).toBe(CUSTOM_HARD_OFFSET);
  });

  it('an empty reminderDaysBefore ([] — the admin removed every row) disables the three worker stages but still leaves escalation alone', async () => {
    const stageRows = resolveStageRows({ reminderDaysBefore: [] });

    await upsertCourseAssignment({
      organizationId: 'org-1',
      courseId: 'course-1',
      assignedByAdminId: 'admin-1',
      stageRows,
    });

    expect(store.get('FRIENDLY_REMINDER')?.enabled).toBe(false);
    expect(store.get('URGENT_REMINDER')?.enabled).toBe(false);
    expect(store.get('DAY_OF_DEADLINE')?.enabled).toBe(false);
    expect(store.get('GRACE_SOFT_ESCALATION')?.offsetDays).toBe(CUSTOM_GRACE_OFFSET);
    expect(store.get('HARD_ESCALATION')?.offsetDays).toBe(CUSTOM_HARD_OFFSET);
  });
});
