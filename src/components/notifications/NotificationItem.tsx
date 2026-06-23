'use client';

import React from 'react';
import { X } from 'lucide-react';
import {
  formatRelativeTime,
  getNotificationVisual,
  type NotificationLike,
} from './notification-display';

interface NotificationItemProps {
  notif: NotificationLike;
  onClick?: () => void;
  /** When provided, renders a delete control on the row. */
  onDelete?: () => void;
}

/** A single notification row, shared by the header dropdown and the full page. */
export default function NotificationItem({ notif, onClick, onDelete }: NotificationItemProps) {
  const { Icon, iconClass, ringClass } = getNotificationVisual(notif.type);
  const showRetake = ['QUIZ_RETRY_LIMIT_REACHED', 'COURSE_RETRY_REQUESTED'].includes(
    notif.type || '',
  );

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
        'flex gap-3 px-5 py-4 transition-colors',
        onClick ? 'cursor-pointer' : '',
        !notif.isRead ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-[#f7fafc]',
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
        <div className="flex items-start justify-between gap-2">
          <h4 className="m-0 text-sm font-semibold text-[#1a202c]">{notif.title}</h4>
          <span className="mt-0.5 shrink-0 whitespace-nowrap text-[11px] text-[#a0aec0]">
            {formatRelativeTime(notif.createdAt)}
          </span>
        </div>
        <p className="m-0 text-[13px] leading-[1.45] text-[#4a5568]">{notif.message}</p>
        {showRetake && (
          <div className="mt-1.5">
            {notif.resolvedAt ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                Retake Assigned
              </span>
            ) : (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
                ➔ Click here to assign retake
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2">
        {!notif.isRead && (
          <span className="mt-1.5 size-2 rounded-full bg-primary" aria-label="Unread" />
        )}
        {onDelete && (
          <button
            type="button"
            aria-label="Delete notification"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1 text-[#cbd5e0] transition-colors hover:bg-[#edf2f7] hover:text-[#718096]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
