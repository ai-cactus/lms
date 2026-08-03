/**
 * Notification catalog — the single, server-safe source of truth for both the
 * display metadata (filter chips + per-user preference toggles) and the engine
 * routing table (tier + which roles a system event notifies).
 *
 * Deliberately free of runtime imports from Prisma or the DB so it can be pulled
 * into client components (the bell UI re-exports it via
 * `src/components/notifications/notification-display.tsx`) and into server-side
 * emit/digest code alike.
 */

import type { Role } from '@/types/next-auth';
import type { NotificationTier } from '@/generated/prisma/enums';

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
  {
    key: 'COURSE_DEADLINE_REMINDER',
    label: 'Deadline reminders',
    description: 'When a course deadline is approaching',
    audience: 'worker',
  },
  {
    key: 'COURSE_OVERDUE',
    label: 'Overdue',
    description: 'When a course deadline has passed',
    audience: 'worker',
  },
  {
    key: 'COMPLIANCE_ESCALATION',
    label: 'Compliance alerts',
    description: 'When an overdue course is escalated for compliance',
    audience: 'admin',
  },
  {
    key: 'COURSE_RETAKE_REMINDER',
    label: 'Retake reminders',
    description: 'When you have remaining quiz attempts to use',
    audience: 'worker',
  },
  {
    key: 'STAFF_ADDED',
    label: 'Staff added',
    description: 'When a worker joins your organization',
    audience: 'admin',
  },
  {
    key: 'DOCUMENT_UPLOADED',
    label: 'Documents',
    description: 'When a document is uploaded to your organization',
    audience: 'admin',
  },
  {
    key: 'ROLE_FALLBACK_TRIGGERED',
    label: 'Unassigned roles',
    description: 'When a notification is redirected to you because a role is unassigned',
    audience: 'admin',
  },
  {
    key: 'COMPLIANCE_LICENSE_EXPIRING',
    label: 'License expiry',
    description: 'When a mandatory compliance license is expiring or expired',
    audience: 'admin',
  },
];

/** The notification types relevant to a given audience (includes 'all'). */
export function notificationTypesFor(audience: NotificationAudience): NotificationTypeMeta[] {
  return NOTIFICATION_TYPES.filter((t) => t.audience === audience || t.audience === 'all');
}

/** Notification types emitted by the engine (`emitNotificationEvent`). */
export type NotificationEngineType =
  | 'STAFF_ADDED'
  | 'DOCUMENT_UPLOADED'
  | 'ROLE_FALLBACK_TRIGGERED'
  | 'COMPLIANCE_LICENSE_EXPIRING';

/** Who an engine event notifies, resolved per emit from the actor's role. */
export interface NotificationTargets {
  /** Roles to notify, in the organization the event belongs to. */
  roles: Role[];
  /**
   * When no user holds any target role, redirect to the organization owner
   * (escalation pathway §2.2). False for events that already target the owner —
   * a fallback there could only ever recurse.
   */
  fallbackToOwner: boolean;
}

export interface NotificationEngineMeta {
  tier: NotificationTier;
  /** Human-readable event name used in digest sections and email subjects. */
  label: string;
  /**
   * Routing decision for one emit. `actorRole` is the role of the user who
   * caused the event (null for system/self-serve events with no actor).
   */
  resolveTargets: (actorRole: Role | null | undefined) => NotificationTargets;
}

/**
 * Engine routing table (Product Notes §2.1/§2.2).
 *
 * - HR adds a worker → the owner is notified.
 * - Anyone else (or nobody) adds a worker → HR, falling back to the owner.
 * - A document is uploaded → the clinical/quality director, falling back to the owner.
 * - A fallback fired → the owner is alerted instantly, with no further fallback.
 */
export const ENGINE_EVENTS: Record<NotificationEngineType, NotificationEngineMeta> = {
  STAFF_ADDED: {
    tier: 'digest',
    label: 'Staff added',
    resolveTargets: (actorRole) =>
      actorRole === 'hr'
        ? { roles: ['owner'], fallbackToOwner: false }
        : { roles: ['hr'], fallbackToOwner: true },
  },
  DOCUMENT_UPLOADED: {
    tier: 'digest',
    label: 'Document uploaded',
    resolveTargets: () => ({ roles: ['clinical_director'], fallbackToOwner: true }),
  },
  ROLE_FALLBACK_TRIGGERED: {
    tier: 'instant',
    label: 'Unassigned role',
    resolveTargets: () => ({ roles: ['owner'], fallbackToOwner: false }),
  },
  // Reserved: the catalog entry exists so the tier/routing is settled, but no
  // emitter fires it yet — credential/licence expiry has no data model.
  COMPLIANCE_LICENSE_EXPIRING: {
    tier: 'instant',
    label: 'Compliance license expiring',
    resolveTargets: () => ({ roles: ['owner', 'hr'], fallbackToOwner: false }),
  },
};
