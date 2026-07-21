'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BellOff, Settings2, Trash2 } from 'lucide-react';
import { getNotificationPreferences, setNotificationPreference } from '@/app/actions/notifications';
import NotificationItem from '@/components/notifications/NotificationItem';
import { useNotifications } from '@/components/notifications/useNotifications';
import {
  notificationTypesFor,
  type NotificationAudience,
} from '@/components/notifications/notification-display';

interface NotificationsViewProps {
  backHref: string;
  audience: NotificationAudience;
}

/** Full-page notifications list: filtering, pagination, delete, and preferences. */
export default function NotificationsView({ backHref, audience }: NotificationsViewProps) {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    isLoadingMore,
    hasMore,
    typeFilter,
    setTypeFilter,
    loadMore,
    markRead,
    markAll,
    remove,
    clearAll,
  } = useNotifications({ autoLoad: true, pageSize: 20 });

  const types = notificationTypesFor(audience);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getNotificationPreferences().then((res) => {
      if (res.success) setPrefs(res.preferences);
    });
  }, []);

  const handleItemClick = (id: string, linkUrl?: string | null) => {
    markRead(id);
    if (linkUrl) router.push(linkUrl);
  };

  const togglePref = (type: string) => {
    const next = !(prefs[type] ?? true);
    setPrefs((prev) => ({ ...prev, [type]: next }));
    setNotificationPreference(type, next);
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    if (window.confirm('Delete all notifications? This cannot be undone.')) clearAll();
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
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={markAll} className="text-sm font-medium text-primary hover:underline">
              Mark all as read
            </button>
          )}
          <button
            onClick={() => setShowPrefs((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#718096] hover:text-[#2d3748]"
          >
            <Settings2 className="size-4" aria-hidden="true" />
            Preferences
          </button>
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:underline"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Clear all
            </button>
          )}
        </div>
      </div>

      {showPrefs && (
        <div className="flex flex-col gap-3 rounded-2xl border border-[#edf2f7] bg-[#fafcff] p-5">
          <h2 className="m-0 text-sm font-semibold text-[#1a202c]">Notify me about</h2>
          <div className="flex flex-col divide-y divide-[#edf2f7]">
            {types.map((t) => {
              const enabled = prefs[t.key] ?? true;
              return (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-center justify-between gap-4 py-2.5"
                >
                  <span className="text-sm text-[#4a5568]">{t.description}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => togglePref(t.key)}
                    className={[
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                      enabled ? 'bg-primary' : 'bg-[#cbd5e0]',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block size-5 transform rounded-full bg-white shadow transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <FilterChip active={typeFilter === null} onClick={() => setTypeFilter(null)}>
          All
        </FilterChip>
        {types.map((t) => (
          <FilterChip
            key={t.key}
            active={typeFilter === t.key}
            onClick={() => setTypeFilter(t.key)}
          >
            {t.label}
          </FilterChip>
        ))}
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
            <p className="m-0 text-sm text-[#a0aec0]">
              {typeFilter
                ? 'No notifications of this type.'
                : 'New notifications will appear here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-[#edf2f7]">
              {notifications.map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notif={notif}
                  onClick={() => handleItemClick(notif.id, notif.linkUrl)}
                  onDelete={() => remove(notif.id)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="border-t border-[#edf2f7] p-3 text-center">
                <button
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="text-sm font-semibold text-primary hover:underline disabled:opacity-60"
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-[#e2e8f0] bg-white text-[#4a5568] hover:bg-[#f7fafc]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
