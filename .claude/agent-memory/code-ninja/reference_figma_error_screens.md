---
name: reference-figma-error-screens
description: Figma LMS-v2 "ERROR SCREENS" section (node 13748:39936) frame→app-surface map, incl. the mis-named "Link Expired" frames that are actually the 404 page
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)", section node `13748:39936`.
The section renders in Figma as **"ADMINS"**, not "ERROR SCREENS" — identify it by node id, not name.

Only **two designs** exist here (each with a desktop + mobile frame), not four:

| Frame | Node | Actually shows | App surface |
|---|---|---|---|
| "Link Expired - 1440px" | `14160:60701` | **Page Not Found** (plug illustration) | `src/app/not-found.tsx` |
| "Link Expired - 375px" | `14160:60749` | Page Not Found, stacked/centered | same |
| "Time out" (1440) | `13748:42817` | "You've been Signed Out" | **no app counterpart** |
| "web sign up" (375x852) | `13748:40458` | Time-out screen, mobile (URL bar reads `theraptly.com/timeout`) | same — no counterpart |

**Frame names are unreliable in this section.** "Link Expired" contains no expired-link copy, and "web sign up" is the mobile time-out screen. Identify frames by screenshot content. The "Link Expired" naming is still meaningful though: `join/[token]` calls `notFound()` for expired/unknown invites, so the 404 page *is* the link-expired screen.

**No `/timeout` route exists.** `InactivityTimer` does `signOut({ callbackUrl: '/login' })` and the login page shows a "Session Expired" `Alert`. Building the designed standalone time-out page would mean a new route + changing the callbackUrl — treat as a product decision, not a UI reconciliation.

**No frame exists for the generic error boundary.** All of `src/app/error.tsx`, `(auth)/error.tsx`, `worker/error.tsx`, `dashboard/(main)/error.tsx` delegate to `src/components/error/RouteErrorBoundary.tsx` ("Something went wrong" + Try again) — undesigned, leave alone.

Scale: the **mobile** frame is 1:1 (clean 16px/22px body). The **desktop** frame's top bar is a 1388px component stretched to 1440 (k≈1.0375), which is why its numbers are decimals — divide top-bar values by 1.0375 to recover round px (33.203→32, 8.301→8, 19.922→19.2). Desktop content values are ~1:1 (heading 45/50, body ~23.77/35).

Useful exact values: top bar h-84, border-b `#e5e7eb` (== `--border-color`, so `border-border` matches); heading `#2d2d2d`; body `#8d8d8d` (no token matches — raw hex); logo 32px mark + 22px wordmark == `<Logo size="nav" />`.

The plug illustration is a **vector**. Export via `download_assets` and take the **`svgAssets`** entry, NOT `export` — the `export` render bakes in the whole dark page background. Committed as `public/images/page-not-found.svg`; this replaced the old `public/images/plug.png` + CSS-blob hack, leaving `plug.png` orphaned.

See [[project_figma_to_css_scale]] and [[reference_figma_lms_v2]].
