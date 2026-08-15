/**
 * Pure-function tests for src/lib/facility/metrics.ts — the risk/readiness
 * formulas shared by the global dashboard. No mocks: every export here is a
 * deterministic function of its inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  computeAuditReadinessPercent,
  classifyAuditReadiness,
  computeRiskLevel,
  computeCompletionPercent,
  computeTrendPercent,
  riskWeight,
  AUDIT_READY_MIN_COMPLETION_PERCENT,
  RISK_HIGH_COMPLETION_PERCENT,
  RISK_LOW_COMPLETION_PERCENT,
  type FacilityComplianceSignals,
} from './metrics';

/** A facility with nothing wrong: no overdue work, no credential pressure, full completion. */
const CLEAN: FacilityComplianceSignals = {
  overdueBeyondGrace: 0,
  overdueWithinGrace: 0,
  completionPercent: 100,
  expiredCredentials: 0,
  expiringCredentials: 0,
};

function signals(overrides: Partial<FacilityComplianceSignals> = {}): FacilityComplianceSignals {
  return { ...CLEAN, ...overrides };
}

describe('computeAuditReadinessPercent', () => {
  it('returns 100 when there are no deadline-bearing enrollments, regardless of on-time count', () => {
    expect(computeAuditReadinessPercent(0, 0)).toBe(100);
  });

  it('returns 100 for a negative withDeadline (defensive — should never happen upstream)', () => {
    expect(computeAuditReadinessPercent(0, -1)).toBe(100);
  });

  it('computes the on-time share rounded to the nearest integer', () => {
    expect(computeAuditReadinessPercent(1, 3)).toBe(33); // 33.33 -> 33
    expect(computeAuditReadinessPercent(2, 3)).toBe(67); // 66.67 -> 67
  });

  it('returns 0 when nothing completed on time', () => {
    expect(computeAuditReadinessPercent(0, 10)).toBe(0);
  });

  it('returns 100 when everything with a deadline completed on time', () => {
    expect(computeAuditReadinessPercent(10, 10)).toBe(100);
  });
});

describe('classifyAuditReadiness (glossary §0.2)', () => {
  it('is audit_ready with zero overdue, zero expired credentials and completion at the minimum', () => {
    expect(
      classifyAuditReadiness(signals({ completionPercent: AUDIT_READY_MIN_COMPLETION_PERCENT })),
    ).toBe('audit_ready');
  });

  it('is not audit_ready one point below the completion minimum', () => {
    expect(
      classifyAuditReadiness(
        signals({ completionPercent: AUDIT_READY_MIN_COMPLETION_PERCENT - 1 }),
      ),
    ).toBe('needs_attention');
  });

  it('is audit_ready for a facility with nothing assigned (no completion to be judged on)', () => {
    expect(classifyAuditReadiness(signals({ completionPercent: null }))).toBe('audit_ready');
  });

  it('is not audit_ready with a single overdue training inside the grace period', () => {
    expect(classifyAuditReadiness(signals({ overdueWithinGrace: 1 }))).toBe('needs_attention');
  });

  it('is critical with an overdue training past the grace period', () => {
    expect(classifyAuditReadiness(signals({ overdueBeyondGrace: 1 }))).toBe('critical');
  });

  it('is critical with an expired credential even when everything else passes', () => {
    expect(classifyAuditReadiness(signals({ expiredCredentials: 1 }))).toBe('critical');
  });

  it('is critical when completion falls below the high-risk floor', () => {
    expect(
      classifyAuditReadiness(signals({ completionPercent: RISK_HIGH_COMPLETION_PERCENT - 1 })),
    ).toBe('critical');
  });

  it('stays audit_ready when a credential is merely expiring, not expired', () => {
    expect(classifyAuditReadiness(signals({ expiringCredentials: 3 }))).toBe('audit_ready');
  });
});

describe('computeRiskLevel (glossary §0.1)', () => {
  it('is low for a facility with no overdue work, full completion and no credential pressure', () => {
    expect(computeRiskLevel(CLEAN)).toBe('low');
  });

  it('is high for any overdue training past the grace period', () => {
    expect(computeRiskLevel(signals({ overdueBeyondGrace: 1 }))).toBe('high');
  });

  it('is high for any expired credential', () => {
    expect(computeRiskLevel(signals({ expiredCredentials: 1 }))).toBe('high');
  });

  it('is high just below the high-risk completion floor', () => {
    expect(computeRiskLevel(signals({ completionPercent: RISK_HIGH_COMPLETION_PERCENT - 1 }))).toBe(
      'high',
    );
  });

  it('is medium exactly at the high-risk completion floor', () => {
    expect(computeRiskLevel(signals({ completionPercent: RISK_HIGH_COMPLETION_PERCENT }))).toBe(
      'medium',
    );
  });

  it('is medium for an overdue training inside the grace period', () => {
    expect(computeRiskLevel(signals({ overdueWithinGrace: 1 }))).toBe('medium');
  });

  it('is medium for a credential expiring inside the window', () => {
    expect(computeRiskLevel(signals({ expiringCredentials: 1 }))).toBe('medium');
  });

  it('is medium one point below the low-risk completion floor', () => {
    expect(computeRiskLevel(signals({ completionPercent: RISK_LOW_COMPLETION_PERCENT - 1 }))).toBe(
      'medium',
    );
  });

  it('is low exactly at the low-risk completion floor', () => {
    expect(computeRiskLevel(signals({ completionPercent: RISK_LOW_COMPLETION_PERCENT }))).toBe(
      'low',
    );
  });

  it('is low for a facility with nothing assigned rather than scoring its absent completion as 0%', () => {
    expect(computeRiskLevel(signals({ completionPercent: null }))).toBe('low');
  });

  it('escalates to high when a beyond-grace overdue coexists with within-grace ones', () => {
    expect(computeRiskLevel(signals({ overdueBeyondGrace: 1, overdueWithinGrace: 9 }))).toBe(
      'high',
    );
  });
});

describe('computeCompletionPercent', () => {
  it('returns 0 for a zero total (no divide-by-zero)', () => {
    expect(computeCompletionPercent(0, 0)).toBe(0);
  });

  it('returns 0 for a negative total (defensive)', () => {
    expect(computeCompletionPercent(3, -1)).toBe(0);
  });

  it('rounds the completion share to the nearest integer', () => {
    expect(computeCompletionPercent(1, 3)).toBe(33);
    expect(computeCompletionPercent(2, 3)).toBe(67);
  });
});

describe('computeTrendPercent', () => {
  it('returns null when the previous value is zero (no baseline)', () => {
    expect(computeTrendPercent(10, 0)).toBeNull();
  });

  it('returns null when the previous value is negative (defensive)', () => {
    expect(computeTrendPercent(10, -5)).toBeNull();
  });

  it('computes a positive percentage change, rounded', () => {
    expect(computeTrendPercent(15, 10)).toBe(50);
  });

  it('computes a negative percentage change, rounded', () => {
    expect(computeTrendPercent(5, 10)).toBe(-50);
  });

  it('returns 0 when current equals previous', () => {
    expect(computeTrendPercent(10, 10)).toBe(0);
  });
});

describe('riskWeight', () => {
  it('orders high above medium above low', () => {
    expect(riskWeight('high')).toBeGreaterThan(riskWeight('medium'));
    expect(riskWeight('medium')).toBeGreaterThan(riskWeight('low'));
  });
});
