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
  AUDIT_READY_MIN_PERCENT,
  AUDIT_NEEDS_ATTENTION_MIN_PERCENT,
  RISK_HIGH_MIN_OVERDUE,
  RISK_MEDIUM_MIN_OVERDUE,
} from './metrics';

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

describe('classifyAuditReadiness', () => {
  it('classifies exactly at the audit_ready boundary as audit_ready', () => {
    expect(classifyAuditReadiness(AUDIT_READY_MIN_PERCENT)).toBe('audit_ready');
  });

  it('classifies one point below the audit_ready boundary as needs_attention', () => {
    expect(classifyAuditReadiness(AUDIT_READY_MIN_PERCENT - 1)).toBe('needs_attention');
  });

  it('classifies exactly at the needs_attention boundary as needs_attention', () => {
    expect(classifyAuditReadiness(AUDIT_NEEDS_ATTENTION_MIN_PERCENT)).toBe('needs_attention');
  });

  it('classifies one point below the needs_attention boundary as critical', () => {
    expect(classifyAuditReadiness(AUDIT_NEEDS_ATTENTION_MIN_PERCENT - 1)).toBe('critical');
  });

  it('classifies 0 as critical', () => {
    expect(classifyAuditReadiness(0)).toBe('critical');
  });

  it('classifies 100 as audit_ready', () => {
    expect(classifyAuditReadiness(100)).toBe('audit_ready');
  });
});

describe('computeRiskLevel', () => {
  it('classifies exactly at the high boundary as high', () => {
    expect(computeRiskLevel(RISK_HIGH_MIN_OVERDUE)).toBe('high');
  });

  it('classifies one below the high boundary as medium', () => {
    expect(computeRiskLevel(RISK_HIGH_MIN_OVERDUE - 1)).toBe('medium');
  });

  it('classifies exactly at the medium boundary as medium', () => {
    expect(computeRiskLevel(RISK_MEDIUM_MIN_OVERDUE)).toBe('medium');
  });

  it('classifies one below the medium boundary as low', () => {
    expect(computeRiskLevel(RISK_MEDIUM_MIN_OVERDUE - 1)).toBe('low');
  });

  it('classifies zero overdue trainings as low', () => {
    expect(computeRiskLevel(0)).toBe('low');
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
