'use client';

import { createContext, useContext, useMemo, useState } from 'react';

/**
 * Shared date-range filter for the Audit Reports tabs. Bounds are `YYYY-MM-DD`
 * strings; an empty string means "unbounded" on that side. An all-empty range
 * means "all time" (no filter). Consumed by every tab so the same range drives
 * both the on-screen views and the exported reports.
 */
export interface AuditDateRange {
  from: string;
  to: string;
}

export const EMPTY_RANGE: AuditDateRange = { from: '', to: '' };

export function isRangeActive(range: AuditDateRange): boolean {
  return Boolean(range.from || range.to);
}

/** Convert the UI range into the optional `{ from, to }` payload actions expect. */
export function toRangeInput(range: AuditDateRange): { from?: string; to?: string } | undefined {
  if (!isRangeActive(range)) return undefined;
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };
}

interface AuditFilterContextValue {
  range: AuditDateRange;
  setRange: (range: AuditDateRange) => void;
}

const AuditFilterContext = createContext<AuditFilterContextValue | null>(null);

export function AuditFilterProvider({ children }: { children: React.ReactNode }) {
  const [range, setRange] = useState<AuditDateRange>(EMPTY_RANGE);
  const value = useMemo(() => ({ range, setRange }), [range]);
  return <AuditFilterContext.Provider value={value}>{children}</AuditFilterContext.Provider>;
}

export function useAuditFilter(): AuditFilterContextValue {
  const ctx = useContext(AuditFilterContext);
  if (!ctx) throw new Error('useAuditFilter must be used within an AuditFilterProvider');
  return ctx;
}
