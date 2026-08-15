'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ListFilter, Settings2, Trash2 } from 'lucide-react';
import EmptyTableState from '@/components/ui/EmptyTableState';
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
    clearAll,
  } = useNotifications({ autoLoad: true, pageSize: 20 });

  const types = notificationTypesFor(audience);
  const [showFilters, setShowFilters] = useState(true);
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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] leading-[1.31] font-semibold tracking-[-0.04em] text-foreground sm:text-[33.5px]">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={markAll}
              className="mr-2 cursor-pointer text-sm font-medium text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
          <button
            type="button"
            aria-label="Toggle filters"
            aria-pressed={showFilters}
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent"
          >
            <ListFilter className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Notification preferences"
            aria-pressed={showPrefs}
            onClick={() => setShowPrefs((v) => !v)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent"
          >
            <Settings2 className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showPrefs && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background-secondary p-5">
          <h2 className="m-0 text-sm font-semibold text-foreground">Notify me about</h2>
          <div className="flex flex-col divide-y divide-border">
            {types.map((t) => {
              const enabled = prefs[t.key] ?? true;
              return (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-center justify-between gap-4 py-2.5"
                >
                  <span className="text-sm text-text-secondary">{t.description}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => togglePref(t.key)}
                    className={[
                      'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
                      enabled ? 'bg-primary' : 'bg-input',
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
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-error hover:underline"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Clear all notifications
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        {showFilters && (
          <div className="flex flex-wrap gap-2 px-5 pt-5 pb-4">
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
        )}

        {isLoading ? (
          <div className="px-5 py-16 text-center text-sm text-text-tertiary">Loading…</div>
        ) : notifications.length === 0 ? (
          <EmptyTableState
            message="You're all caught up!"
            subMessage={
              typeFilter ? 'No notifications of this type.' : 'New notifications will appear here.'
            }
          />
        ) : (
          <>
            <div className="flex flex-col divide-y divide-border px-4">
              {notifications.map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notif={notif}
                  onClick={() => handleItemClick(notif.id, notif.linkUrl)}
                  onViewDetails={() => handleItemClick(notif.id, notif.linkUrl)}
                />
              ))}
            </div>
            {hasMore && (
              <div className="border-t border-border p-3 text-center">
                <button
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="cursor-pointer text-sm font-semibold text-primary hover:underline disabled:opacity-60"
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
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-background text-foreground hover:bg-background-secondary',
      ].join(' ')}
    >
      {active && <Check className="size-4" aria-hidden="true" />}
      {children}
    </button>
  );
}
