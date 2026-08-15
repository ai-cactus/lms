'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  formatRelativeTime,
  getNotificationVisual,
  type NotificationLike,
} from './notification-display';

interface NotificationItemProps {
  notif: NotificationLike;
  onClick?: () => void;
  /** When provided, rows carrying a `linkUrl` render a "View details" action. */
  onViewDetails?: () => void;
}

/** A single notification row, shared by the header dropdown and the full page. */
export default function NotificationItem({ notif, onClick, onViewDetails }: NotificationItemProps) {
  const { Icon, iconClass, ringClass } = getNotificationVisual(notif.type);
  const showRetake = ['QUIZ_RETRY_LIMIT_REACHED', 'COURSE_RETRY_REQUESTED'].includes(
    notif.type || '',
  );
  const showViewDetails = Boolean(onViewDetails && notif.linkUrl);

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={[
        'flex gap-3 bg-background px-5 py-4 transition-colors hover:bg-background-secondary',
        onClick ? 'cursor-pointer' : '',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
          ringClass,
        ].join(' ')}
      >
        <Icon className={['size-[18px]', iconClass].join(' ')} aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h4 className="m-0 text-sm font-semibold text-foreground">{notif.title}</h4>
        <p className="m-0 text-[13px] leading-[1.45] text-text-muted">{notif.message}</p>
        {showRetake && (
          <div className="mt-1.5">
            {notif.resolvedAt ? (
              <span className="w-fit rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                Retake Assigned
              </span>
            ) : (
              <span className="w-fit rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
                ➔ Click here to assign retake
              </span>
            )}
          </div>
        )}
        {showViewDetails && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails?.();
            }}
            className="mt-2.5 h-8 w-fit px-3 text-xs"
          >
            View details
          </Button>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end">
        <span className="flex h-5 items-center">
          {!notif.isRead && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
        </span>
        <span className="whitespace-nowrap text-xs text-text-muted">
          {formatRelativeTime(notif.createdAt)}
        </span>
      </div>
    </div>
  );
}
