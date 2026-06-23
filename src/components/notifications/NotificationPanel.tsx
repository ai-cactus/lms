'use client';

import React from 'react';
import Link from 'next/link';
import { BellOff } from 'lucide-react';
import NotificationItem from './NotificationItem';
import type { NotificationLike } from './notification-display';

interface NotificationPanelProps {
  notifications: NotificationLike[];
  unreadCount: number;
  isLoading: boolean;
  onMarkAllAsRead: () => void;
  onItemClick: (id: string, linkUrl?: string | null) => void;
  viewAllHref: string;
  onViewAll?: () => void;
}

/**
 * The header notification dropdown. The scroll body deliberately avoids
 * `justify-center` so that the newest items (sorted newest-first) stay
 * reachable at the top once the list overflows.
 */
export default function NotificationPanel({
  notifications,
  unreadCount,
  isLoading,
  onMarkAllAsRead,
  onItemClick,
  viewAllHref,
  onViewAll,
}: NotificationPanelProps) {
  return (
    <div className="absolute right-0 top-[calc(100%+12px)] z-50 flex max-h-[min(560px,calc(100vh-6rem))] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-[#edf2f7] bg-white shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#edf2f7] bg-[#fafcff] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-base font-semibold text-[#1a202c]">Notifications</h3>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            className="cursor-pointer text-[13px] font-medium text-primary hover:underline"
            onClick={onMarkAllAsRead}
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Body */}
      <div className="min-h-[140px] flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center px-5 py-8 text-center">
            <p className="m-0 text-[13px] text-[#a0aec0]">Loading…</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex min-h-[140px] flex-col items-center justify-center px-5 py-8 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[#f7fafc] text-[#cbd5e0]">
              <BellOff className="size-8" />
            </div>
            <h4 className="m-0 mb-1 text-[15px] font-semibold text-[#4a5568]">
              You&apos;re all caught up!
            </h4>
            <p className="m-0 text-[13px] leading-[1.5] text-[#a0aec0]">
              New notifications will appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[#edf2f7]">
            {notifications.map((notif) => (
              <NotificationItem
                key={notif.id}
                notif={notif}
                onClick={() => onItemClick(notif.id, notif.linkUrl)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <Link
          href={viewAllHref}
          onClick={onViewAll}
          className="border-t border-[#edf2f7] bg-[#fafcff] px-5 py-3 text-center text-[13px] font-semibold text-primary transition-colors hover:bg-[#f1f5ff]"
        >
          View all notifications
        </Link>
      )}
    </div>
  );
}
