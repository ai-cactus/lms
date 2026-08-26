---
name: billing-cancel-resume-seats-e2e-fixes
description: Sandbox cannot run Next.js at all (no SWC bindings, no Google Fonts egress); a genuine 3-way duplicate-render string needs heading-role + ancestor-walk scoping, not .first()/.last(); User.id has no @db.Uuid so array casts must be ::text[]
metadata:
  type: project
---

From the `bugfix/billing-cancel-resume-seats` branch (PR #525), extending
`tests/e2e/billing-plan-change-and-gating.spec.ts` for #25/#26/#29/#33.

**This sandbox cannot start the Next.js server in any mode — a hard,
two-layered blocker, not something to keep retrying:**
1. `next build` / `next dev` default to Turbopack in Next 16.3.1, which requires
   native SWC bindings (`@next/swc-linux-x64-gnu`/`musl`) that are simply not
   installed in `node_modules` here — fails immediately with "Turbopack is not
   supported on this platform... Only WebAssembly (WASM) bindings were loaded."
2. Forcing the fallback (`next build --webpack`) gets past that, then fails at
   font compilation: `next/font` (`JetBrains_Mono`, `Playfair_Display` in
   `src/app/layout.tsx`) needs outbound network access to Google's font CDN
   (`ETIMEDOUT`/`ENETUNREACH` connecting to a `172.217.16.234:443`-style IP),
   which this sandbox does not have.

**How to apply:** don't spend more than ~2 attempts confirming this before
reporting it as an environment blocker to the orchestrator — e2e must be
verified by CI (or a working local machine) for this repo, full stop, in this
sandbox. Report unit-test results (which run fine) as the landed, verifiable
work, and hand e2e specs over unexecuted with this exact diagnosis rather than
claiming a pass.

**A genuine (not route-announcer) 3-way duplicate-render string, found via CI,
not locally:** "Your subscription is paused" renders in THREE places at once
on `/dashboard/billing?tab=subscription` — `BillingPausedBanner.tsx` (site-wide,
layout-level), `SubscriptionTab.tsx`'s own status card, and `OverviewTab.tsx`
(not mounted simultaneously, since only one tab renders at a time, but still a
real duplicate source). A bare `getByText` is a genuine Playwright strict-mode
violation here — NOT the [[full-e2e-suite-strict-mode-route-announcer]]-style
issue PR #520 fixed, and the coordinator was explicit: do not paper over it
with `.first()`/`.last()`, since that silently stops checking the region that
actually matters (a test that passes by not looking is worse than the failure).

Fix technique, reusable whenever a string is intentionally repeated across a
layout banner + a tab-local card: of the duplicates, only ONE tends to be a
real semantic heading (`<h3>` in `SubscriptionTab.tsx:779`; the banner and
`OverviewTab` both use a plain `<p>` for the identical text) — so
`page.getByRole('heading', { name: ... })` uniquely resolves to the one
component that matters, same targeting principle as #520 (role over bare
text), just for a different root cause. To then scope a nearby control (the
tab's own "Continue Plan" button, distinct from the banner's own button with
identical accessible name), walk up from that heading with
`heading.locator('..').locator('..')` to its containing status-card row —
empirically verified against the installed playwright-core (1.62.1): resolves
to exactly the row containing both the heading and its sibling button column,
excludes an identically-labeled button elsewhere on the page. For the
"cleared" assertion (proving the paused state actually went away after a
mutation), do NOT re-check the tab-local heading — once the tab switches, that
component unmounts and the heading trivially disappears regardless of whether
the mutation actually worked, making the assertion vacuous. Check the
layout-level banner instead (`page.getByRole('status')`, unique on the billing
page — confirmed only two other unrelated `role="status"` elements in the repo,
on course-wizard and auditor pages, never present alongside `/dashboard/billing`)
— it's a real server component read from the DB via `layout.tsx`, so its
disappearance after a `router.refresh()` is genuine proof.

**Raw-SQL id casts: `User.id` (and every other model's `id`) has no
`@db.Uuid`** — `prisma/auth.prisma:32` is `id String @id @default(uuid())`, so
the Postgres column is `text` holding uuid-shaped strings, not a native `uuid`
column. `DELETE FROM users WHERE id = ANY($1::uuid[])` fails with `operator
does not exist: text = uuid`; the fix is `::text[]`. Scalar binds (`WHERE id =
$1`) never needed a cast because Postgres infers `text` from context — only
`= ANY($1::type[])` needs an explicit cast, and it needs the RIGHT one. Audit
every raw-SQL array cast in a new e2e spec for this, not just the one that
happened to blow up — a cast failing inside a test's own `finally` cleanup
block reports the WHOLE test as failed regardless of whether its own
assertions already passed, which can mask whether the thing being tested
(here, the #33 seat-count fix) was ever actually proven.

See also [[project-test-framework]] for the general Vitest/e2e conventions and
[[rbac-sidebar-module-gating-tests]] for prior `role="status"`-adjacent
scoping notes.
