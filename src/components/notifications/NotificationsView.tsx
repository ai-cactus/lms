'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BellOff } from 'lucide-react';
import { getNotifications, markAsRead, markAllAsRead } from '@/app/actions/notifications';
import NotificationItem from '@/components/notifications/NotificationItem';
import type { NotificationLike } from '@/components/notifications/notification-display';

interface NotificationsViewProps {
  backHref: string;
}

/** Full-page notifications list, reachable from the header "View all" footer. */
export default function NotificationsView({ backHref }: NotificationsViewProps) {
  const [notifications, setNotifications] = useState<NotificationLike[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      const res = await getNotifications();
      if (active && res.success && res.notifications) {
        setNotifications(res.notifications as NotificationLike[]);
        setUnreadCount(res.unreadCount || 0);
      }
      if (active) setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleItemClick = async (id: string, linkUrl?: string | null) => {
    await markAsRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    if (linkUrl) router.push(linkUrl);
  };

  const handleMarkAll = async () => {
    await markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-5 px-5 py-6 sm:px-8">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[#718096] transition-colors hover:text-[#2d3748]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#1a202c]">Notifications</h1>
          {unreadCount > 0 && (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAll}
            className="text-sm font-medium text-primary hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#edf2f7] bg-white">
        {isLoading ? (
          <div className="px-5 py-16 text-center text-sm text-[#a0aec0]">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#f7fafc] text-[#cbd5e0]">
              <BellOff className="size-9" />
            </div>
            <h2 className="m-0 mb-1 text-lg font-semibold text-[#4a5568]">
              You&apos;re all caught up!
            </h2>
            <p className="m-0 text-sm text-[#a0aec0]">New notifications will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#edf2f7]">
            {notifications.map((notif) => (
              <NotificationItem
                key={notif.id}
                notif={notif}
                onClick={() => handleItemClick(notif.id, notif.linkUrl)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
