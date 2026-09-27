import { describe, it, expect, vi } from 'vitest';
import { ENROLLMENT_ACTIVITY_THROTTLE_MS, touchEnrollmentActivity } from './activity';

type ActivityDb = Parameters<typeof touchEnrollmentActivity>[0];

function makeDb() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return { db: { enrollment: { updateMany } } as unknown as ActivityDb, updateMany };
}

describe('touchEnrollmentActivity', () => {
  it('throttles to one write per window: only rows never stamped or stamped before now − 5 min match', async () => {
    const { db, updateMany } = makeDb();
    const now = new Date('2026-09-26T12:00:00.000Z');

    await touchEnrollmentActivity(db, 'enr-1', now);

    expect(ENROLLMENT_ACTIVITY_THROTTLE_MS).toBe(5 * 60 * 1000);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'enr-1',
        OR: [
          { lastActivityAt: null },
          { lastActivityAt: { lt: new Date('2026-09-26T11:55:00.000Z') } },
        ],
      },
      data: { lastActivityAt: now },
    });
  });

  it('defaults `now` to the current time', async () => {
    const { db, updateMany } = makeDb();
    const before = Date.now();

    await touchEnrollmentActivity(db, 'enr-1');

    const stamped: Date = updateMany.mock.calls[0][0].data.lastActivityAt;
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
    expect(stamped.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('writes through whichever client it is given, so it composes with a $transaction client', async () => {
    const base = makeDb();
    const tx = makeDb();

    await touchEnrollmentActivity(tx.db, 'enr-1');

    expect(tx.updateMany).toHaveBeenCalledTimes(1);
    expect(base.updateMany).not.toHaveBeenCalled();
  });

  it('is a silent no-op inside the throttle window (zero matched rows does not throw)', async () => {
    const { db, updateMany } = makeDb();
    updateMany.mockResolvedValue({ count: 0 });

    await expect(touchEnrollmentActivity(db, 'enr-1')).resolves.toBeUndefined();
  });
});
