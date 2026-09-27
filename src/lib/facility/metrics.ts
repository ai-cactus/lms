/**
 * Facility risk / readiness formulas and the dashboards' shared windows.
 *
 * Every threshold and every derived percentage lives here, deliberately free of
 * Prisma and React, so a product ruling on "what counts as audit ready" or "when
 * is a facility high-risk" is a one-line change in one file rather than a hunt
 * through queries and components.
 *
 * Metric names and definitions follow the founder's dashboard definitions and
 * the 2026-09-26 rulings (Dashboard Metrics Glossary for risk/readiness). HOW each
 * figure is counted lives in `@/lib/dashboard/definitions`; this module owns the
 * thresholds it reads and the help text that quotes them.
 */

/** Look-back/look-ahead window shared by every trend chip and rolling metric. */
export const TREND_WINDOW_DAYS = 30;

/** Dormant rule R1: a member who joined this long ago and has not logged in since. */
export const DORMANT_LOGIN_DAYS = 14;

/** Dormant rule R2: an assignment still not started this long after it opened. */
export const DORMANT_UNSTARTED_DAYS = 7;

/** Dormant rule R3: a started, unfinished enrolment with no engagement for this long. */
export const DORMANT_STALLED_DAYS = 14;

/** How far ahead a certificate's renewal-cycle expiry counts as expiring. */
export const EXPIRING_CREDENTIALS_WINDOW_DAYS = 30;

/**
 * How far ahead an unfinished deadline counts as "due soon" — ONE window for the
 * Status Tracker's "at risk" rows and the Global View's "Approaching Deadlines",
 * which previously disagreed (7 vs 14 days, BUG-35).
 */
export const DUE_SOON_WINDOW_DAYS = 14;

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
  /** Certificates past their renewal-cycle expiry and not renewed since. */
  expiredCredentials: number;
  /** Certificates expiring within {@link EXPIRING_CREDENTIALS_WINDOW_DAYS} days. */
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
 * Definitions surfaced in-product as help text, so a KPI card and the table
 * column showing the same metric quote the same sentence. Each one describes
 * exactly what `@/lib/dashboard/definitions` counts — change both together.
 */
export const METRIC_DEFINITIONS = {
  totalFacilities: 'Every facility in your organisation that you can view.',
  totalStaff:
    'Active staff accounts: every active worker, plus active managers and owners who have been assigned training on a live course.',
  activeLearners:
    'Staff with at least one assigned course they have not yet finished. Person-level count — one staff member with 3 unfinished courses counts once.',
  ongoingCourses:
    'Published courses with at least one unfinished enrolment by active staff. Course-level count — each course counts once.',
  firstTimePassRate:
    "Of each learner's first submitted attempt at each quiz, the share that met the quiz's passing score. Renewals count as first attempts; retakes do not.",
  overdueTrainings:
    'Individual assignments past their due date and not yet finished, across active staff. Assignment-level count.',
  approachingDeadlines: `Individual assignments not yet finished, due within the next ${DUE_SOON_WINDOW_DAYS} days.`,
  dormantStaff: `Active staff who have not logged in for ${DORMANT_LOGIN_DAYS} days (after their first ${DORMANT_LOGIN_DAYS} days), have an assignment not started ${DORMANT_UNSTARTED_DAYS} days after it opened, or have a started course with no activity for ${DORMANT_STALLED_DAYS} days. Having no assignments alone is not dormant.`,
  expiringCredentials: `Certificates of active staff on recurring training whose renewal cycle ends within the next ${EXPIRING_CREDENTIALS_WINDOW_DAYS} days and that have not already been renewed.`,
  staffCount: 'Active staff currently assigned to this facility.',
  activeTrainings: 'Assignments at this facility not yet finished. Assignment-level count.',
  trainingCompletion: 'Finished assignments divided by all assignments at this facility.',
  totalActiveCourses:
    'Published courses with at least one unfinished enrolment by staff in this facility.',
  totalAssignedLearners:
    'Staff in this facility with at least one assigned course they have not yet finished.',
  averageGrade:
    "The mean of each enrolment's grade, where an enrolment's grade is the average of its best submitted score on each quiz.",
  auditReadiness: `Audit Ready only with zero overdue trainings, zero expired credentials and training completion at or above ${AUDIT_READY_MIN_COMPLETION_PERCENT}%.`,
  riskLevel: `High when a training is over ${RISK_OVERDUE_GRACE_DAYS} days overdue, completion is below ${RISK_HIGH_COMPLETION_PERCENT}% or a credential has expired. Medium when a training is 1–${RISK_OVERDUE_GRACE_DAYS} days overdue, completion is ${RISK_HIGH_COMPLETION_PERCENT}–${RISK_LOW_COMPLETION_PERCENT - 1}% or a credential expires within ${EXPIRING_CREDENTIALS_WINDOW_DAYS} days. Low otherwise.`,
} as const;

/** Ordering weight for "most at risk first" — high risk sorts before low. */
const RISK_WEIGHT: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1 };

export function riskWeight(level: RiskLevel): number {
  return RISK_WEIGHT[level];
}
