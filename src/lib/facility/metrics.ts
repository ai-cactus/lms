/**
 * Facility risk / readiness formulas for the global (all-facilities) dashboard.
 *
 * Every threshold and every derived percentage lives here, deliberately free of
 * Prisma and React, so a product ruling on "what counts as audit ready" or "when
 * is a facility high-risk" is a one-line change in one file rather than a hunt
 * through queries and components.
 *
 * Terms, windows and formulas follow the Dashboard Metrics Glossary
 * (`multi_facility_notes.pdf`, §0 canonical terms, §0.1 Risk Level, §0.2 Audit
 * Readiness, §0.3 time windows), which is the single source of truth for metric
 * names and definitions.
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

/** Glossary §0.3: a membership is "dormant" after this many days without a login. */
export const DORMANT_STAFF_DAYS = 30;

/** Glossary §0.3: how far ahead a renewal-cycle deadline counts as expiring. */
export const EXPIRING_CREDENTIALS_WINDOW_DAYS = 30;

/** Glossary §0.3: how far ahead an incomplete deadline counts as approaching. */
export const APPROACHING_DEADLINE_WINDOW_DAYS = 14;

/** Glossary §0.1: past this many days overdue, a training escalates to High risk. */
export const RISK_OVERDUE_GRACE_DAYS = 14;

/** Glossary §0.1: training completion below this percentage is High risk. */
export const RISK_HIGH_COMPLETION_PERCENT = 80;

/** Glossary §0.1: training completion at or above this percentage can be Low risk. */
export const RISK_LOW_COMPLETION_PERCENT = 95;

/** Glossary §0.2: audit readiness requires at least this training completion. */
export const AUDIT_READY_MIN_COMPLETION_PERCENT = 95;

export type RiskLevel = 'low' | 'medium' | 'high';
export type AuditReadinessLevel = 'audit_ready' | 'needs_attention' | 'critical';

/**
 * The compliance signals a facility's Risk Level (§0.1) and Audit Readiness
 * (§0.2) are both derived from, so the two chips can never disagree about the
 * same facility.
 */
export interface FacilityComplianceSignals {
  /** Overdue trainings more than {@link RISK_OVERDUE_GRACE_DAYS} days past due. */
  overdueBeyondGrace: number;
  /** Overdue trainings 1–{@link RISK_OVERDUE_GRACE_DAYS} days past due. */
  overdueWithinGrace: number;
  /**
   * Training completion for the facility, or `null` when it has nothing
   * assigned — an empty facility has no completion to be judged on, so the
   * completion conditions are skipped rather than scored as 0%.
   */
  completionPercent: number | null;
  /** Credentials already past their expiration date. */
  expiredCredentials: number;
  /** Credentials expiring within {@link EXPIRING_CREDENTIALS_WINDOW_DAYS} days. */
  expiringCredentials: number;
}

/**
 * A facility's Risk Level per glossary §0.1 — any one condition in a band is
 * sufficient, and the bands are evaluated most severe first. Single home for
 * the cutoffs: change them here and every table, chip and sort order follows.
 */
export function computeRiskLevel(signals: FacilityComplianceSignals): RiskLevel {
  const {
    overdueBeyondGrace,
    overdueWithinGrace,
    completionPercent,
    expiredCredentials,
    expiringCredentials,
  } = signals;

  if (
    overdueBeyondGrace > 0 ||
    expiredCredentials > 0 ||
    (completionPercent !== null && completionPercent < RISK_HIGH_COMPLETION_PERCENT)
  ) {
    return 'high';
  }

  if (
    overdueWithinGrace > 0 ||
    expiringCredentials > 0 ||
    (completionPercent !== null && completionPercent < RISK_LOW_COMPLETION_PERCENT)
  ) {
    return 'medium';
  }

  return 'low';
}

/**
 * The on-time completion share shown alongside the Audit Readiness chip: of the
 * assigned trainings that carry a deadline, those completed on or before it. A
 * supporting figure only — the chip itself is graded on §0.2's criteria by
 * {@link classifyAuditReadiness}. A facility with no deadline-bearing
 * assignments has nothing to be measured against and scores 100 rather than 0.
 */
export function computeAuditReadinessPercent(
  onTimeCompletions: number,
  withDeadline: number,
): number {
  if (withDeadline <= 0) return 100;
  return Math.round((onTimeCompletions / withDeadline) * 100);
}

/**
 * Audit Readiness per glossary §0.2: a facility is Audit Ready only with zero
 * overdue trainings, zero expired credentials and training completion at or
 * above {@link AUDIT_READY_MIN_COMPLETION_PERCENT}. Anything short of that is
 * "Critical" when it trips a §0.1 High-risk condition and "Needs Attention"
 * otherwise, so the two chips grade the same facility on the same evidence.
 *
 * §0.2's fourth criterion — required documentation on file for all active
 * staff — has no representation in the schema yet and is therefore not scored.
 */
export function classifyAuditReadiness(signals: FacilityComplianceSignals): AuditReadinessLevel {
  const { overdueBeyondGrace, overdueWithinGrace, completionPercent, expiredCredentials } = signals;

  const auditReady =
    overdueBeyondGrace + overdueWithinGrace === 0 &&
    expiredCredentials === 0 &&
    (completionPercent === null || completionPercent >= AUDIT_READY_MIN_COMPLETION_PERCENT);

  if (auditReady) return 'audit_ready';
  return computeRiskLevel(signals) === 'high' ? 'critical' : 'needs_attention';
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

/**
 * Glossary definitions surfaced in-product as help text, so a KPI card and the
 * table column showing the same metric quote the same sentence.
 */
export const METRIC_DEFINITIONS = {
  activeLearners:
    'Staff who currently have at least one course in progress. Person-level count — one staff member with 3 in-progress courses counts once.',
  overdueTrainings:
    'Assigned trainings past their due date with no completion recorded. Course-level count.',
  approachingDeadlines: `Assigned trainings not yet complete, due within the next ${APPROACHING_DEADLINE_WINDOW_DAYS} days.`,
  dormantStaff: `Staff with active employment status but no login or activity in the last ${DORMANT_STAFF_DAYS} days.`,
  expiringCredentials: `Staff credentials on file expiring within the next ${EXPIRING_CREDENTIALS_WINDOW_DAYS} days.`,
  staffCount: 'Active/employed staff at this facility.',
  activeTrainings: 'Course assignments currently in progress at this facility. Course-level count.',
  trainingCompletion: 'Completed assignments divided by total assignments at this facility.',
  auditReadiness: `Audit Ready only with zero overdue trainings, zero expired credentials and training completion at or above ${AUDIT_READY_MIN_COMPLETION_PERCENT}%.`,
  riskLevel: `High when a training is over ${RISK_OVERDUE_GRACE_DAYS} days overdue, completion is below ${RISK_HIGH_COMPLETION_PERCENT}% or a credential has expired. Medium when a training is 1–${RISK_OVERDUE_GRACE_DAYS} days overdue, completion is ${RISK_HIGH_COMPLETION_PERCENT}–${RISK_LOW_COMPLETION_PERCENT - 1}% or a credential expires within ${EXPIRING_CREDENTIALS_WINDOW_DAYS} days. Low otherwise.`,
} as const;

/** Ordering weight for "most at risk first" — high risk sorts before low. */
const RISK_WEIGHT: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

export function riskWeight(level: RiskLevel): number {
  return RISK_WEIGHT[level];
}
