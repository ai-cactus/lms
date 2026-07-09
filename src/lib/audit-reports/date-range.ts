// Shared, DB-agnostic date-range helpers for audit reports.
//
// A range is expressed as optional `from`/`to` calendar dates (`YYYY-MM-DD`) or
// full ISO datetimes. An empty range means "no filter" (all records). We filter
// on the enrollment `startedAt` timestamp everywhere — it is the audit-meaningful
// "date assigned / training active" field used consistently across the report
// builders and on-screen queries.
import type { ReportPeriod } from './types';

export interface AuditDateRangeInput {
  from?: string | null;
  to?: string | null;
}

export interface ResolvedDateRange {
  gte?: Date;
  lte?: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseBoundary(value: string | null | undefined, edge: 'start' | 'end'): Date | undefined {
  if (value == null || value === '') return undefined;
  // A bare calendar date is anchored to the start/end of that UTC day so ranges
  // are inclusive of both endpoints' full days regardless of server timezone.
  const iso = DATE_ONLY.test(value)
    ? `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : value;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: "${value}"`);
  }
  return parsed;
}

/**
 * Validate and resolve a raw range into concrete `Date` boundaries.
 * `from` maps to the start (00:00:00.000Z) and `to` to the end (23:59:59.999Z)
 * of their calendar days when given as `YYYY-MM-DD`.
 *
 * @throws if a value is unparseable or if `from` is after `to`.
 */
export function resolveDateRange(input: AuditDateRangeInput | null | undefined): ResolvedDateRange {
  if (!input) return {};
  const gte = parseBoundary(input.from, 'start');
  const lte = parseBoundary(input.to, 'end');
  if (gte && lte && gte.getTime() > lte.getTime()) {
    throw new Error('Invalid date range: "from" must be on or before "to".');
  }
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

/**
 * Build a Prisma `where` fragment restricting enrollment `startedAt` to the
 * range. Returns `{}` (no predicate) for an empty range so all records match.
 * Safe to spread into any enrollment `where` clause.
 *
 * @throws (via {@link resolveDateRange}) on an invalid range.
 */
export function startedAtWhere(input: AuditDateRangeInput | null | undefined): {
  startedAt?: { gte?: Date; lte?: Date };
} {
  const { gte, lte } = resolveDateRange(input);
  if (!gte && !lte) return {};
  return { startedAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
}

/**
 * Normalize a raw range into the JSON-serializable {@link ReportPeriod} stored
 * on a report result (for header rendering). Returns `undefined` when empty.
 */
export function toReportPeriod(
  input: AuditDateRangeInput | null | undefined,
): ReportPeriod | undefined {
  const from = input?.from || null;
  const to = input?.to || null;
  if (!from && !to) return undefined;
  return { from, to };
}
