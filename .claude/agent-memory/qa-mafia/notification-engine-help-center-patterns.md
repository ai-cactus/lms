---
name: notification-engine-help-center-patterns
description: Notification/escalation engine routing table, dedupe mechanics, digest recipient-resolution nuance, system-admin digest trigger, and Help Center audience-gating matrix (tested 2026-08-03, PR #415)
metadata:
  type: project
---

## Feature: Notification Engine + Escalation Pathways + Help Center (branch feat/new-feature-25-05, PR #415)

**Engine routing table** (`src/lib/notifications/catalog.ts` `ENGINE_EVENTS`):
- `STAFF_ADDED` (tier=digest): actor role `hr` → targets `['owner']` (no fallback, can't recurse); any other actor (or none) → targets `['hr']`, `fallbackToOwner:true`.
- `DOCUMENT_UPLOADED` (tier=digest): always targets `['clinical_director']`, `fallbackToOwner:true`.
- `ROLE_FALLBACK_TRIGGERED` (tier=instant): the §2.2 meta-alert, always targets `['owner']`, no fallback. Fired automatically by `emitFallbackAlert` in `src/lib/notifications/emit.ts` whenever `usedFallback=true` on any other engine event — **dedupe key is `role-fallback:<role>` with a 24h window**, so HR-vacancy and Clinical-Director-vacancy alerts are independent (don't throttle each other).
- `COMPLIANCE_LICENSE_EXPIRING` is a reserved catalog entry only — no emitter fires it yet (correctly out of scope for any live test).

**Both tiers write the bell row instantly** — only the *email* is tier-gated (instant tier emails immediately via `sendInstantNotificationEmail`; digest tier defers the email to the next digest run, leaving `notification_events.status='pending'`).

**Critical nuance — digest recipients are re-resolved at SEND time, not pinned at emit time.** `src/lib/notifications/digest.ts`'s `readRouting` replays the pinned `roles`/`fallbackToOwner` from the event's payload, but then calls `resolveRoleRecipients` fresh against current DB state. So if a STAFF_ADDED event originally fell back to the owner (HR was vacant when it fired) but HR gets hired before the digest runs, **the digest email goes to the new HR holder, not the owner who got the original bell alert.** This is intentional/documented ("someone hired into the HR seat yesterday receives today's digest of events routed to HR before they existed") but is a real behavioral split between bell (frozen at emit) and email (live at send) worth flagging to product/stakeholders on any related story — don't assume the same person gets both.

**Self-exclusion edge case:** when the owner personally invites the very first manager into an org with no HR, that specific STAFF_ADDED event has **zero recipients** (owner is both actor and the only fallback candidate, correctly excluded from their own event) — but the *separate* `ROLE_FALLBACK_TRIGGERED` meta-alert still reaches the owner fine (it doesn't inherit the original event's actor exclusion). Don't mistake the STAFF_ADDED 0-recipient event for a bug; check the paired fallback event.

**Testing the 24h dedupe window without waiting:** backdating an existing `notification_events` row's `created_at` via direct DB `UPDATE` (e.g. `-interval '26 hours'`) is a clean, legitimate way to clear `isThrottled`'s window and isolate a scenario from an earlier, unrelated trigger of the same dedupe key — disclose this plainly in any report as a test-data manipulation, not a product-code change.

**Manually triggering the digest:** log into `/system` with `SYSTEM_ADMIN_PASSWORD` (sets the `system_admin_auth` cookie via the page's own login form — no need to extract/inspect the cookie value), then from *within that authenticated page* run `playwright-cli eval` with a `fetch('/api/system/notifications/run', {method:'POST', body: JSON.stringify({dryRun:false, force:true|false})})` — cookies ride along automatically. `force:true` clears today's claimed/failed digest-run rows so you can re-send; `force:false` respects the existing per-period claim. Response `summary` reports `organizationsScanned/organizationsDue/digestsSent/emailsSent/eventsDispatched/skipped/errors` — a `skipped:1` with `emailsSent:0` on a non-forced re-run (when a *new* pending event exists after the day's digest already sent) is the correct, rigorous proof of the `(organizationId, periodKey)` unique-constraint idempotency — better evidence than just "second run found nothing pending."

**Settings page is fully owner-gated, not just the Notifications tab** — `src/app/dashboard/(main)/settings/page.tsx` blocks the entire route server-side (`role !== 'owner'` → full-page "You don't have access to Settings", no Settings link in the sidebar) for HR, Supervisor, Clinical Director, and Finance alike.

## Help Center audience-gating matrix (`src/lib/help/articles.ts`)

5 categories total: Staff & Team Management (admin), Course & Training Management (admin), Document Storage & Compliance (mixed: 2 admin articles + 1 `audience:'all'` article), Billing & Subscriptions (admin), Using Your Training Portal (worker, 5 articles).

- `/help` (public, unauthenticated, audience `'all'`) shows **all 5 categories** — so "the four product categories" from a story brief undercounts by one (the worker category renders publicly too); not a bug, just a wording nuance to flag.
- `/dashboard/help` (audience `'admin'`) shows exactly the 4 admin categories, filters out "Using Your Training Portal" entirely (0 matching articles).
- `/worker/help` (audience `'worker'`) shows only "Document Storage & Compliance" (just the 1 shared article) + "Using Your Training Portal" (all 5) — no Billing/Staff/Course categories.
- Search (`helpArticleSearchText`) is a real client-side substring filter now — confirmed working (narrows to matching articles, shows "No results found" empty state for a miss). This supersedes the earlier Phase 5 finding that Help Center had no search.
- Pricing answer (`getHelpPlanPricing`) pulls live Stripe prices per the 4-tier lineup (Starter/Growth/Pro/Enterprise) — confirmed live-priced, not hardcoded placeholder text.

**Gotcha: the entire `/worker/*` route group is billing-gated org-wide** (`WorkerBillingBlockedScreen` — "Training temporarily unavailable") whenever the org has no active subscription — unrelated to Help Center itself, but will block `/worker/help` too. A fresh QA-created org (no subscription) can't be used to test worker-side pages; use an existing subscribed seed org's worker account instead (see [[local-dev-env-access]] for the `/forgot-password` → MailHog password-reset pattern to get into a seed fixture account with an unknown password) — confirmed `e2e-test-org`'s `worker@test.com` has an active `growth` subscription and works for this purpose.

See [[prod-build-local-env-precedence]] for the Docker/`.env.production` environment gotchas hit while setting up this run.
