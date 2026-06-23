'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearAllNotifications,
  deleteNotification,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from '@/app/actions/notifications';
import type { NotificationLike } from './notification-display';

interface UseNotificationsOptions {
  /** Page size for list fetches. */
  pageSize?: number;
  /** Poll the unread count every N ms (and on window focus). 0 disables. */
  pollMs?: number;
  /** Load the first page on mount. Headers leave this false and load on open. */
  autoLoad?: boolean;
}

/**
 * Shared notification state: pagination, unread-count polling, and the
 * mark/delete mutations. Used by both header dropdowns and the full page.
 */
export function useNotifications(options?: UseNotificationsOptions) {
  const pageSize = options?.pageSize ?? 20;
  const pollMs = options?.pollMs ?? 0;
  const autoLoad = options?.autoLoad ?? false;

  const [notifications, setNotifications] = useState<NotificationLike[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(autoLoad);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [typeFilter, setTypeFilterState] = useState<string | null>(null);

  const cursorRef = useRef<string | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    const res = await getUnreadCount();
    if (res.success) setUnreadCount(res.unreadCount);
  }, []);

  const load = useCallback(
    async (type: string | null) => {
      setIsLoading(true);
      const res = await getNotifications({ limit: pageSize, type });
      if (res.success) {
        setNotifications(res.notifications as NotificationLike[]);
        setUnreadCount(res.unreadCount);
        cursorRef.current = res.nextCursor;
        setHasMore(res.hasMore);
      }
      setIsLoading(false);
    },
    [pageSize],
  );

  const refresh = useCallback(() => load(typeFilter), [load, typeFilter]);

  const loadMore = useCallback(async () => {
    if (!cursorRef.current || isLoadingMore) return;
    setIsLoadingMore(true);
    const res = await getNotifications({
      limit: pageSize,
      type: typeFilter,
      cursor: cursorRef.current,
    });
    if (res.success) {
      setNotifications((prev) => [...prev, ...(res.notifications as NotificationLike[])]);
      cursorRef.current = res.nextCursor;
      setHasMore(res.hasMore);
    }
    setIsLoadingMore(false);
  }, [pageSize, typeFilter, isLoadingMore]);

  const setTypeFilter = useCallback(
    (type: string | null) => {
      setTypeFilterState(type);
      load(type);
    },
    [load],
  );

  const markRead = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      await markAsRead(id);
      refreshUnreadCount();
    },
    [refreshUnreadCount],
  );

  const markAll = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markAllAsRead();
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      await deleteNotification(id);
      refreshUnreadCount();
    },
    [refreshUnreadCount],
  );

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    setHasMore(false);
    cursorRef.current = null;
    await clearAllNotifications();
  }, []);

  // Initial load / unread-count seed.
  useEffect(() => {
    if (autoLoad) load(null);
    else refreshUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the unread count and refresh on window focus.
  useEffect(() => {
    if (pollMs <= 0) return;
    const interval = setInterval(refreshUnreadCount, pollMs);
    const onFocus = () => refreshUnreadCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [pollMs, refreshUnreadCount]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isLoadingMore,
    hasMore,
    typeFilter,
    setTypeFilter,
    refresh,
    loadMore,
    markRead,
    markAll,
    remove,
    clearAll,
    refreshUnreadCount,
  };
}
