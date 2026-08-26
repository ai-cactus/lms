/**
 * Unit tests for the F-051 deferred-assignment intent (Issue #14).
 *
 * `buildPendingAssignment` turns the wizard's step-9 selection into the
 * payload parked on `Course.pendingAssignment`; `parsePendingAssignment`
 * validates it back out when `publishCourse` replays it. Both must round-trip
 * cleanly and must never let a malformed/legacy blob block a publish.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildPendingAssignment, parsePendingAssignment } from './pending-assignment';
import { logger } from '@/lib/logger';

describe('buildPendingAssignment', () => {
  it('returns null when neither assignments nor a role assignment were targeted', () => {
    expect(buildPendingAssignment({})).toBeNull();
    expect(buildPendingAssignment({ assignments: [] })).toBeNull();
    expect(buildPendingAssignment({ roleAssignment: { roles: [] } })).toBeNull();
  });

  it('builds an email-mode payload from assignments + due date/time', () => {
    const pending = buildPendingAssignment({
      assignments: ['alice@example.com', 'bob@example.com'],
      dueDate: new Date('2026-09-01T00:00:00Z'),
      dueTime: '5:00 PM',
    });

    expect(pending).toEqual({
      mode: 'email',
      emails: ['alice@example.com', 'bob@example.com'],
      dueAt: '2026-09-01T17:00:00.000Z',
    });
  });

  it('builds an email-mode payload with a null dueAt when no due date is set', () => {
    const pending = buildPendingAssignment({ assignments: ['alice@example.com'] });

    expect(pending).toEqual({
      mode: 'email',
      emails: ['alice@example.com'],
      dueAt: null,
    });
  });

  it('builds a roles-mode payload, carrying every role-assignment setting through', () => {
    const pending = buildPendingAssignment({
      roleAssignment: {
        roles: ['nurse', 'hr'],
        dueWindowDays: 14,
        remindersEnabled: true,
        reminderDaysBefore: [7, 1],
        renewalCycle: 'annual',
      },
      dueDate: new Date('2026-09-01T00:00:00Z'),
      dueTime: '9:00 AM',
    });

    expect(pending).toEqual({
      mode: 'roles',
      roles: ['nurse', 'hr'],
      dueDate: '2026-09-01T00:00:00.000Z',
      dueTime: '9:00 AM',
      dueWindowDays: 14,
      remindersEnabled: true,
      reminderDaysBefore: [7, 1],
      renewalCycle: 'annual',
    });
  });

  it('prefers roleAssignment over assignments when both are somehow present', () => {
    const pending = buildPendingAssignment({
      assignments: ['alice@example.com'],
      roleAssignment: { roles: ['nurse'] },
    });

    expect(pending).toMatchObject({ mode: 'roles', roles: ['nurse'] });
  });

  it('omits dueDate/dueTime from a roles payload when neither was set', () => {
    const pending = buildPendingAssignment({ roleAssignment: { roles: ['nurse'] } });

    expect(pending).toEqual({
      mode: 'roles',
      roles: ['nurse'],
      dueDate: null,
      dueTime: null,
    });
  });
});

describe('parsePendingAssignment', () => {
  const ctx = { courseId: 'course-1' };

  it('returns null for a genuinely empty column (null)', () => {
    expect(parsePendingAssignment(null, ctx)).toBeNull();
  });

  it('returns null for an undefined value', () => {
    expect(parsePendingAssignment(undefined, ctx)).toBeNull();
  });

  it('round-trips an email-mode payload', () => {
    const payload = { mode: 'email', emails: ['alice@example.com'], dueAt: null };
    expect(parsePendingAssignment(payload, ctx)).toEqual(payload);
  });

  it('round-trips a roles-mode payload', () => {
    const payload = {
      mode: 'roles',
      roles: ['nurse'],
      dueDate: '2026-09-01T00:00:00.000Z',
      dueTime: '9:00 AM',
      dueWindowDays: 14,
      remindersEnabled: true,
      reminderDaysBefore: [7, 1],
      renewalCycle: 'annual',
    };
    expect(parsePendingAssignment(payload, ctx)).toEqual(payload);
  });

  it('rejects an email-mode payload with an empty emails array', () => {
    const result = parsePendingAssignment({ mode: 'email', emails: [] }, ctx);
    expect(result).toBeNull();
  });

  it('rejects a malformed/unknown-shape blob and logs a warning identifying the course', () => {
    const result = parsePendingAssignment({ foo: 'bar' }, ctx);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Malformed pendingAssignment'),
        courseId: 'course-1',
      }),
    );
  });

  it('rejects a legacy/unrecognized mode string cleanly, never throwing', () => {
    expect(() =>
      parsePendingAssignment({ mode: 'legacy-shape', people: ['a@b.com'] }, ctx),
    ).not.toThrow();
    expect(parsePendingAssignment({ mode: 'legacy-shape', people: ['a@b.com'] }, ctx)).toBeNull();
  });

  it('rejects a roles-mode payload naming an invalid role', () => {
    const result = parsePendingAssignment({ mode: 'roles', roles: ['not-a-real-role'] }, ctx);
    expect(result).toBeNull();
  });
});
