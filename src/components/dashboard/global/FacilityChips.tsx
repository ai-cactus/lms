import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { AuditReadinessLevel, RiskLevel } from '@/lib/facility/metrics';

const RISK_PRESENTATION: Record<RiskLevel, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-error/10 text-error' },
  medium: { label: 'Medium', className: 'bg-warning/15 text-warning' },
  low: { label: 'Low', className: 'bg-success/10 text-success' },
};

const READINESS_PRESENTATION: Record<AuditReadinessLevel, { label: string; className: string }> = {
  audit_ready: { label: 'Audit Ready', className: 'bg-success/10 text-success' },
  needs_attention: { label: 'Needs Attention', className: 'bg-warning/15 text-warning' },
  critical: { label: 'Critical', className: 'bg-error/10 text-error' },
};

export function RiskLevelChip({ level }: { level: RiskLevel }) {
  const { label, className } = RISK_PRESENTATION[level];
  return (
    <Badge variant="ghost" className={`px-3 py-1 text-xs font-semibold ${className}`}>
      {label}
    </Badge>
  );
}

export function AuditReadinessChip({ level }: { level: AuditReadinessLevel }) {
  const { label, className } = READINESS_PRESENTATION[level];
  return (
    <Badge variant="ghost" className={`px-2.5 py-0.5 text-[11px] font-semibold ${className}`}>
      {label}
    </Badge>
  );
}
