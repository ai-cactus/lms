/**
 * BUG-47 — both portals render an inbox, and one browser can hold an admin and
 * a worker session for two DIFFERENT accounts. The inbox actions used to prefer
 * the admin session, so the worker header counted, listed and mutated the admin
 * account's notifications. Each action now reads only the portal its caller
 * names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, prismaMock } = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  prismaMock: {
    notification: {
      count: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    notificationPreference: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/notifications/live-course-links', () => ({
  withLiveCourseLinks: async (rows: unknown[]) => rows,
}));

import {
  clearAllNotifications,
  deleteNotification,
  getNotificationPreferences,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
  setNotificationPreference,
} from './notifications';

const ADMIN_OU = 'ou-admin-account';
const WORKER_OU = 'ou-worker-account';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue({
    user: { id: 'admin-1', role: 'owner', organizationUserId: ADMIN_OU },
  });
  mockWorkerAuth.mockResolvedValue({
    user: { id: 'worker-1', role: 'nurse', organizationUserId: WORKER_OU },
  });
  prismaMock.notification.count.mockResolvedValue(0);
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  prismaMock.notificationPreference.upsert.mockResolvedValue({});
});

const ownerOf = (mock: { mock: { calls: unknown[][] } }) =>
  (mock.mock.calls[0][0] as { where: { organizationUserId?: string } }).where.organizationUserId;

describe('the worker portal acts as the worker account', () => {
  it('getUnreadCount counts the worker inbox without consulting the admin portal', async () => {
    await getUnreadCount('worker');

    expect(ownerOf(prismaMock.notification.count)).toBe(WORKER_OU);
    expect(mockAdminAuth).not.toHaveBeenCalled();
  });

  it('getNotifications lists the worker inbox', async () => {
    await getNotifications('worker', { limit: 20 });

    expect(ownerOf(prismaMock.notification.findMany)).toBe(WORKER_OU);
  });

  it('markAsRead and markAllAsRead mutate only the worker inbox', async () => {
    await markAsRead('worker', 'n-1');
    await markAllAsRead('worker');

    const owners = prismaMock.notification.updateMany.mock.calls.map(
      ([arg]) => (arg as { where: { organizationUserId: string } }).where.organizationUserId,
    );
    expect(owners).toEqual([WORKER_OU, WORKER_OU]);
  });

  it('deleteNotification and clearAllNotifications delete only from the worker inbox', async () => {
    await deleteNotification('worker', 'n-1');
    await clearAllNotifications('worker');

    const owners = prismaMock.notification.deleteMany.mock.calls.map(
      ([arg]) => (arg as { where: { organizationUserId: string } }).where.organizationUserId,
    );
    expect(owners).toEqual([WORKER_OU, WORKER_OU]);
  });

  it('preferences are read and written for the worker membership', async () => {
    await getNotificationPreferences('worker');
    await setNotificationPreference('worker', 'COURSE_ASSIGNED', false);

    expect(ownerOf(prismaMock.notificationPreference.findMany)).toBe(WORKER_OU);
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { organizationUserId: WORKER_OU, type: 'COURSE_ASSIGNED', enabled: false },
      }),
    );
  });
});

describe('the admin portal acts as the admin account', () => {
  it('getUnreadCount counts the admin inbox without consulting the worker portal', async () => {
    await getUnreadCount('admin');

    expect(ownerOf(prismaMock.notification.count)).toBe(ADMIN_OU);
    expect(mockWorkerAuth).not.toHaveBeenCalled();
  });
});

describe('no portal, no inbox', () => {
  it('the named portal having no session refuses rather than falling back to the other', async () => {
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getUnreadCount('worker')).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(prismaMock.notification.count).not.toHaveBeenCalled();
  });

  it('an unchecked realm resolves to no session', async () => {
    await expect(markAllAsRead('portal' as never)).resolves.toEqual({
      success: false,
      error: 'Unauthorized',
    });
    expect(prismaMock.notification.updateMany).not.toHaveBeenCalled();
  });
});
