/**
 * Facility risk / readiness formulas for the global (all-facilities) dashboard.
 *
 * Every threshold and every derived percentage lives here, deliberately free of
 * Prisma and React, so a product ruling on "what counts as audit ready" or "when
 * is a facility high-risk" is a one-line change in one file rather than a hunt
 * through queries and components.
 */
import type { EnrollmentStatus } from '@/generated/prisma/enums';

/**
 * In-flight enrollment statuses — assigned but not yet resolved. Mirrors the
 * partial-unique "active enrollment" set on `Enrollment` (see
 * `prisma/enrollment.prisma`) so "active learner" here means the same thing the
 * database means.
 */
export const ACTIVE_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  'enrolled',
  'assigned',
  'in_progress',
  'lessons_complete',
];

/**
 * Statuses that take an enrollment out of the outstanding population. Matches
 * the reminder status tracker's terminal set, so "overdue" on the dashboard and
 * "overdue" on the Status Tracker page can never disagree.
 */
export const COMPLETED_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['completed', 'attested'];

/** Look-back/look-ahead window shared by every trend chip and rolling metric. */
export const TREND_WINDOW_DAYS = 30;

/** A membership is "inactive" after this many days without a login. */
export const INACTIVE_STAFF_DAYS = 30;

/** How far ahead a renewal-cycle deadline counts as an expiring credential. */
export const EXPIRING_CREDENTIALS_WINDOW_DAYS = 30;

/** Audit readiness at or above this percentage is "Audit Ready". */
export const AUDIT_READY_MIN_PERCENT = 90;

/** Below {@link AUDIT_READY_MIN_PERCENT} but at or above this is "Needs Attention". */
export const AUDIT_NEEDS_ATTENTION_MIN_PERCENT = 60;

/** Overdue trainings at or above this count make a facility "High" risk. */
export const RISK_HIGH_MIN_OVERDUE = 10;

/** Overdue trainings at or above this count (but below high) make it "Medium". */
export const RISK_MEDIUM_MIN_OVERDUE = 5;

export type RiskLevel = 'low' | 'medium' | 'high';
export type AuditReadinessLevel = 'audit_ready' | 'needs_attention' | 'critical';

/**
 * A facility's risk level, derived solely from its outstanding overdue-training
 * count. Single home for the cutoffs — change them here and every table, chip
 * and sort order follows.
 */
export function computeRiskLevel(overdueTrainings: number): RiskLevel {
  if (overdueTrainings >= RISK_HIGH_MIN_OVERDUE) return 'high';
  if (overdueTrainings >= RISK_MEDIUM_MIN_OVERDUE) return 'medium';
  return 'low';
}

/**
 * Audit readiness = on-time completion only: of the assigned trainings that
 * carry a deadline, the share completed on or before it. A facility with no
 * deadline-bearing assignments has nothing to be measured against and scores
 * 100 rather than 0.
 */
export function computeAuditReadinessPercent(
  onTimeCompletions: number,
  withDeadline: number,
): number {
  if (withDeadline <= 0) return 100;
  return Math.round((onTimeCompletions / withDeadline) * 100);
}

export function classifyAuditReadiness(percent: number): AuditReadinessLevel {
  if (percent >= AUDIT_READY_MIN_PERCENT) return 'audit_ready';
  if (percent >= AUDIT_NEEDS_ATTENTION_MIN_PERCENT) return 'needs_attention';
  return 'critical';
}

/** Share of enrollments that reached a completed/attested state. */
export function computeCompletionPercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Percentage change from the previous window to the current one. Returns `null`
 * when there is no baseline to compare against (a previous value of zero), so
 * callers can omit the trend chip instead of rendering a meaningless ∞%.
 */
export function computeTrendPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Ordering weight for "most at risk first" — high risk sorts before low. */
const RISK_WEIGHT: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

export function riskWeight(level: RiskLevel): number {
  return RISK_WEIGHT[level];
}
