import {
  AlertTriangle,
  Bell,
  BookOpen,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

/** Shape shared by the dropdown panel and the full-page notifications view. */
export interface NotificationLike {
  id: string;
  title: string;
  message: string;
  type?: string | null;
  isRead: boolean;
  linkUrl?: string | null;
  resolvedAt?: Date | string | null;
  createdAt: Date | string;
}

export type NotificationAudience = 'admin' | 'worker' | 'all';

export interface NotificationTypeMeta {
  key: string;
  /** Short label for filter chips. */
  label: string;
  /** Sentence used in the preferences panel. */
  description: string;
  audience: NotificationAudience;
}

/** Catalog of notification types — drives filter chips and preference toggles. */
export const NOTIFICATION_TYPES: NotificationTypeMeta[] = [
  {
    key: 'COURSE_ASSIGNED',
    label: 'Assigned',
    description: 'When a course is assigned to you',
    audience: 'worker',
  },
  {
    key: 'RETAKE_ASSIGNED',
    label: 'Retakes',
    description: 'When an admin assigns you a quiz retake',
    audience: 'worker',
  },
  {
    key: 'COURSE_PASSED',
    label: 'Completed',
    description: 'When a worker completes a course',
    audience: 'admin',
  },
  {
    key: 'COURSE_FAILED',
    label: 'Failed',
    description: 'When a worker fails a quiz',
    audience: 'admin',
  },
  {
    key: 'COURSE_RETRY_REQUESTED',
    label: 'Retry requests',
    description: 'When a worker requests a course retry',
    audience: 'admin',
  },
  {
    key: 'QUIZ_RETRY_LIMIT_REACHED',
    label: 'Retry limit',
    description: 'When a worker reaches their quiz retry limit',
    audience: 'admin',
  },
];

/** The notification types relevant to a given audience (includes 'all'). */
export function notificationTypesFor(audience: NotificationAudience): NotificationTypeMeta[] {
  return NOTIFICATION_TYPES.filter((t) => t.audience === audience || t.audience === 'all');
}

/** Compact, human-friendly "time ago" — falls back to a date past a week. */
export function formatRelativeTime(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return date.toLocaleDateString();
}

interface NotificationVisual {
  Icon: LucideIcon;
  iconClass: string;
  ringClass: string;
}

/** Maps a notification type to its leading icon + accent colors. */
export function getNotificationVisual(type?: string | null): NotificationVisual {
  switch (type) {
    case 'COURSE_ASSIGNED':
      return { Icon: BookOpen, iconClass: 'text-blue-600', ringClass: 'bg-blue-50' };
    case 'COURSE_PASSED':
      return { Icon: CheckCircle2, iconClass: 'text-emerald-600', ringClass: 'bg-emerald-50' };
    case 'COURSE_FAILED':
      return { Icon: XCircle, iconClass: 'text-red-600', ringClass: 'bg-red-50' };
    case 'COURSE_RETRY_REQUESTED':
      return { Icon: RefreshCw, iconClass: 'text-amber-600', ringClass: 'bg-amber-50' };
    case 'QUIZ_RETRY_LIMIT_REACHED':
      return { Icon: AlertTriangle, iconClass: 'text-amber-600', ringClass: 'bg-amber-50' };
    case 'RETAKE_ASSIGNED':
      return { Icon: RotateCcw, iconClass: 'text-indigo-600', ringClass: 'bg-indigo-50' };
    default:
      return { Icon: Bell, iconClass: 'text-slate-500', ringClass: 'bg-slate-100' };
  }
}
