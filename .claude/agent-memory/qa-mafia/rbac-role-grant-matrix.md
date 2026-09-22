---
name: rbac-role-grant-matrix
description: RBAC grant-matrix QA facts, re-checked against permissions.ts on 2026-09-21. Supervisor is read-only, CD/Finance have no staff CRUD, billing is owner/admin/finance only. Covers worker-vs-manager routing, the billing-plan-gates-authoring trap and join-by-code
metadata:
  type: project
---

**Source of truth: `src/lib/rbac/permissions.ts` and `docs/local/RBAC_for_multi-tenancy-updated.md`.** Read these before writing RBAC acceptance criteria. The live checks below date from 2026-07, but the role facts were re-checked against the code on 2026-09-21.

**Manager roles:**
- **owner:** full access, including billing. Never grantable via invite.
- **admin:** full access, including billing. Also holds `organization.edit`.
- **supervisor:** READ-ONLY on documents, courses, staff and audits, and facility-scoped (`readEverythingExceptBilling`). It can create assignments, enrollments and certificates, but has **no `invite.create`** and cannot change roles.
- **hr:** full staff (`user.*`) and invite CRUD, full `document.*`, and `organization.edit`. No billing.
- **clinical_director:** course, assessment and document CRU (no delete), plus assignment/enrollment. **No `user.*` staff CRUD and no invite.**
- **finance:** billing only, plus `organization.read`/`facility.read`. No courses since 2026-08-25, no certificates since 2026-09-16, no staff.

**Worker roles:** 8 roles with identical learner-only permissions: psychiatrist_prescriber, nurse, therapist_clinician, case_manager, behavioral_health_technician, peer_support_specialist, front_desk_admin, facilities_support.

**The invite affordance is hidden for roles without `invite.create`.** `StaffListClient.tsx` gates the "Add Staff" button on `can(..., 'invite.create')`, so Finance, Clinical Director and Supervisor see no button at all. When testing any new role-gated UI, still check for the "affordance shown, backend silently rejects" anti-pattern.

**Routing:** workers land on `/worker` (Dashboard, Trainings, Certificates). Managers land on `/dashboard`. A worker navigating to a manager-only URL gets a hard route-group redirect, not a logout. The session stays valid.

**Billing scope:** the Billing nav link is gated by `can(role, 'billing.read')`. Direct navigation to `/dashboard/billing` without it renders a styled access-denied card from a server-side check in `src/app/dashboard/(main)/billing/page.tsx`.

**Correction 2026-09-21:** `billing.*` belongs to owner, admin and finance. Supervisor, HR and Clinical Director are blocked in both the sidebar and on direct URL.

**A fresh self-signup owner has no organization yet.** It gets `role = owner` with `organization_id = NULL`, and the proxy routes it into the `/onboarding` wizard (5 steps) until the organization row exists. Budget time for the multi-field form when setting up a fresh owner account.

**Course authoring is gated by ORG BILLING PLAN, not role.** In an org with no active paid plan, "Create Course" shows the same "A plan is required…" paywall for every role, including owner. So role-specific "cannot author courses" criteria CANNOT be verified in an unsubscribed org: you see the billing gate first, giving a false PASS for restricted roles and a false FAIL for allowed ones. Use a subscribed fixture org (D01/B4, see [[staging-two-facility-fixture-recipe]]).

**Join-by-code:** a 6-digit code (Profile → "Your Organization" → "Worker Onboarding" → Generate Code, 6h expiry) always assigns `front_desk_admin` (`DEFAULT_SELF_SERVE_WORKER_ROLE` in `src/lib/rbac/role-utils.ts`). The joiner must already be authenticated with NO organizationId. It is not a public code-redemption page.

**Layout bug on the join-by-code confirmation screen — FIXED, re-verified 2026-07-06 (later session):** previously, at desktop viewport widths ≥1024px (Tailwind `lg` breakpoint, e.g. common 1200×769), a decorative right-hand hero image panel (`hidden lg:block`) visually overlapped and intercepted pointer-events on the "Join Organization" button (Playwright reported "subtree intercepts pointer events", requiring escalating retries or a resize below 1024px to click through). Re-tested at the exact same 1200×769 viewport after a defensive `z-10`/`z-0` stacking fix in `onboarding-worker` — the click now succeeds immediately with zero retries. Still worth a quick spot-check if this screen's layout is touched again.

**UPDATE 2026-07-27 (staging, fix commit `0bcebc3`) — billing-route RBAC leak FIXED and re-verified live.** The previously-reported gap (Supervisor/HR/Clinical Director getting 200 + real Stripe payment-method data on `GET /api/billing/payment-methods` and 200 on `POST /api/billing/portal`, despite the registry reserving `billing.*` to owner+finance) is closed: all 12 billing routes now go through `authorize('billing.read'|'billing.edit')`. Live-confirmed all three non-billing roles get 403 (`{"error":"Forbidden","code":"INSUFFICIENT_PERMISSIONS"}`) on `overview`/`invoices`/`payment-methods`/`portal`, while owner and finance still get 200 on all four. See `qa-reports/2026-07-27-fix-verification-regression.md` for the full per-route matrix.


See [[dual-session-cookie-bug]]: a stale admin cookie can mask a worker out-of-scope-block test, so clear it between cross-category logins in the same browser.
