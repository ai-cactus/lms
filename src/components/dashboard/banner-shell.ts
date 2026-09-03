/**
 * The shared shell for the site-wide dashboard banners rendered by
 * `src/app/dashboard/(main)/layout.tsx` — currently BillingPausedBanner and
 * StatusTrackerAlertBanner.
 *
 * These banners sit INSIDE the layout's padded scroll container, not above it,
 * so they need to read as contained cards. The billing banner was still styled
 * as a full-bleed strip (`border-b`, no margin, no max-width, no radius) left
 * over from when it rendered outside that container, which made it look
 * unpadded and left it butting directly against the next banner — only one of
 * the two carried a bottom margin, so a stack of both had no gap at all.
 *
 * Layout only: each banner keeps its own border/background tone, since they
 * signal different things.
 */
export const DASHBOARD_BANNER_SHELL =
  'mx-auto mb-6 flex w-full max-w-[1400px] flex-col items-start gap-3 rounded-[12px] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5';
