import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/auth.worker', () => ({ auth: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as notificationActions from './notifications';

/**
 * Every export of a 'use server' module is a publicly callable endpoint. The
 * notification creators take recipient + content from the caller with no
 * session check, so re-exporting them here would let anyone forge in-app
 * notifications (with an arbitrary "View details" link) into any tenant.
 */
describe('notifications Server Action surface', () => {
  it('does not expose the internal notification creators', () => {
    expect(notificationActions).not.toHaveProperty('createNotification');
    expect(notificationActions).not.toHaveProperty('notifyOrganizationAdmins');
  });

  it('exposes exactly the session-scoped inbox actions', () => {
    // Adding an export here makes it a public endpoint — it must resolve the
    // caller's own membership before touching any row.
    expect(Object.keys(notificationActions).sort()).toEqual([
      'clearAllNotifications',
      'deleteNotification',
      'getNotificationPreferences',
      'getNotifications',
      'getUnreadCount',
      'markAllAsRead',
      'markAsRead',
      'setNotificationPreference',
    ]);
  });
});
