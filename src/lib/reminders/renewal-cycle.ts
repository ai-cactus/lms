import type { RenewalCycle } from '@/generated/prisma/enums';

/**
 * Length of a renewal cycle in days. Approximate calendar spans (monthly ≈ 30,
 * quarterly ≈ 90, semiannual ≈ 180, annual ≈ 365) — only a consistent interval
 * from completion to the next deadline is required, not an exact anniversary.
 * `none` is 0 (the assignment never renews).
 *
 * Shared by the renewal sweep (which creates the next enrolment at
 * `completedAt + cycleLengthDays`) and the dashboards (which read a
 * certificate's expiry as `issuedAt + cycleLengthDays`), so "when does this
 * credential lapse" has one answer.
 */
export function cycleLengthDays(cycle: RenewalCycle): number {
  switch (cycle) {
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'semiannual':
      return 180;
    case 'annual':
      return 365;
    case 'none':
      return 0;
  }
}
