/**
 * Tests for NotificationsView — the full-page notifications list added in the
 * Notifications page restyle.
 *
 * Covers the two pieces of new interactive state called out as coverage gaps:
 * filter-chip selection (drives `useNotifications`' `setTypeFilter`, which
 * re-fetches with the chosen type) and the per-type preference toggle switch
 * (drives `setNotificationPreference` with an optimistic UI flip).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetNotifications,
  mockGetUnreadCount,
  mockMarkAsRead,
  mockMarkAllAsRead,
  mockClearAllNotifications,
  mockDeleteNotification,
  mockGetNotificationPreferences,
  mockSetNotificationPreference,
  mockPush,
} = vi.hoisted(() => ({
  mockGetNotifications: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockMarkAllAsRead: vi.fn(),
  mockClearAllNotifications: vi.fn(),
  mockDeleteNotification: vi.fn(),
  mockGetNotificationPreferences: vi.fn(),
  mockSetNotificationPreference: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('@/app/actions/notifications', () => ({
  getNotifications: mockGetNotifications,
  getUnreadCount: mockGetUnreadCount,
  markAsRead: mockMarkAsRead,
  markAllAsRead: mockMarkAllAsRead,
  clearAllNotifications: mockClearAllNotifications,
  deleteNotification: mockDeleteNotification,
  getNotificationPreferences: mockGetNotificationPreferences,
  setNotificationPreference: mockSetNotificationPreference,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

import NotificationsView from './NotificationsView';

const NOTIF = {
  id: 'notif-1',
  title: 'Course assigned',
  message: 'You were assigned HIPAA Basics',
  type: 'COURSE_ASSIGNED',
  isRead: false,
  linkUrl: null,
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetNotifications.mockResolvedValue({
    success: true,
    notifications: [NOTIF],
    nextCursor: null,
    hasMore: false,
    unreadCount: 1,
  });
  mockGetUnreadCount.mockResolvedValue({ success: true, unreadCount: 1 });
  mockGetNotificationPreferences.mockResolvedValue({ success: true, preferences: {} });
});

describe('NotificationsView filter chips', () => {
  it('marks "All" active by default and re-fetches with the chosen type on click', async () => {
    const user = userEvent.setup();
    render(<NotificationsView backHref="/dashboard" audience="worker" />);

    await waitFor(() =>
      expect(mockGetNotifications).toHaveBeenCalledWith({ limit: 20, type: null }),
    );

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Assigned' }));

    await waitFor(() =>
      expect(mockGetNotifications).toHaveBeenCalledWith({ limit: 20, type: 'COURSE_ASSIGNED' }),
    );
    expect(screen.getByRole('button', { name: 'Assigned' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('NotificationsView preference toggles', () => {
  it('flips a switch and persists the new value via setNotificationPreference', async () => {
    const user = userEvent.setup();
    mockSetNotificationPreference.mockResolvedValue({ success: true });
    render(<NotificationsView backHref="/dashboard" audience="worker" />);

    await waitFor(() => expect(mockGetNotificationPreferences).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Notification preferences' }));

    const assignedSwitch = screen.getByRole('switch', { name: /When a course is assigned to you/ });
    // No stored preference row yet — defaults to enabled.
    expect(assignedSwitch).toHaveAttribute('aria-checked', 'true');

    await user.click(assignedSwitch);

    expect(mockSetNotificationPreference).toHaveBeenCalledWith('COURSE_ASSIGNED', false);
    expect(assignedSwitch).toHaveAttribute('aria-checked', 'false');
  });

  it('respects a stored disabled preference as the initial switch state', async () => {
    const user = userEvent.setup();
    mockGetNotificationPreferences.mockResolvedValue({
      success: true,
      preferences: { COURSE_ASSIGNED: false },
    });
    render(<NotificationsView backHref="/dashboard" audience="worker" />);

    await user.click(screen.getByRole('button', { name: 'Notification preferences' }));

    const assignedSwitch = await screen.findByRole('switch', {
      name: /When a course is assigned to you/,
    });
    expect(assignedSwitch).toHaveAttribute('aria-checked', 'false');
  });
});
