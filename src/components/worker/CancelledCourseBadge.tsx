import { Ban } from 'lucide-react';

/**
 * The learner-facing status badge for a course archived out from under them.
 *
 * Archiving cancels a course for its learners (Q-04/Q-05/Q-06), so the row stays
 * on every learner list — history, including completed training, must not vanish
 * — but reads as cancelled and offers nothing actionable. Shared by the dashboard
 * table and the trainings Completed tab so the two cannot drift into different
 * words for one state.
 */
export default function CancelledCourseBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-error/10 px-3 py-1.5 text-xs font-semibold text-error">
      <Ban className="size-3" aria-hidden="true" />
      Cancelled
    </span>
  );
}
