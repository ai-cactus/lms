---
name: onboarding-invite-settings-phase-tests
description: Test patterns/gotchas from the 5-step onboarding wizard, staff-invite 2-step modal rewrite, and new Settings page (Phases A/B/C on branch rbac)
metadata:
  type: project
---

Verified 2026-07-08 on branch `rbac`: three phases landed together — Phase A
(onboarding wizard rewritten from 4 steps to 5, with a new step4 "Invite your
managers" and a real step2 document-upload flow via
`src/app/actions/onboarding-documents.ts`), Phase B (`InviteStaffModal`
rewritten into a 2-step email→assign-roles flow; `createInvites` now takes
per-item `{email, role}[]`), Phase C (new owner-only `/dashboard/settings`
page with Users & Permissions / Roles / Facility tabs).

**Regression found and fixed — stale button-text assertion.**
`StaffListClient.test.tsx` asserted `getByRole('button', { name: /add staff/i })`
but the Phase B rewrite renamed the button to "Add Workers". This is the same
recurring pattern noted in [[rbac-8-worker-role-split]] and
[[join-invite-critical-fix-regression]]: any UI-copy rename during these RBAC/
onboarding phases silently breaks exact-text test assertions without breaking
compilation. Always grep the actual rendered JSX string before trusting an
existing test's copy-based selector when a phase touches that component.

**Gotcha for e2e/Playwright selectors — the shared `Field` component's `id`
clone does NOT reach a Radix `Select`'s real trigger DOM node.** `Field`
(`src/components/ui/field.tsx`) renders `<Label htmlFor={controlId}>` then
`React.cloneElement(children, { id: controlId, ... })`. For a plain `<Input>`
child this works fine (the `id` lands on the real `<input>`, so
`getByLabel('X')` resolves it). But when the child is `<Select>` (the shadcn
wrapper around `radix-ui`'s `SelectPrimitive.Root`), `Root` doesn't render a
DOM element at all — it just spreads props into its React Context provider —
so the injected `id` is inert and never reaches `SelectTrigger`'s actual button.
Confirmed by reading `node_modules/@radix-ui/react-select/dist/index.mjs`:
`Select = (props) => <SelectProvider {...providerProps}>...` with no `id`
forwarding to `SelectTrigger`. **Practical effect: `page.getByLabel('Country')`,
`getByLabel('Number of Staff')`, `getByLabel('HIPAA Compliance Confirmation')`,
etc. do NOT work in Playwright for any Field-wrapped Select in this repo** —
onboarding step1/step2/step3/step4, the invite-modal role picker, and the
Settings Facility-type Select are all affected. Use positional locators
(`page.getByRole('combobox').nth(n)`, DOM order per the step's source) or the
trigger's visible placeholder/selected-value text instead (e.g.
`getByRole('button', { name: 'Select an option' })` after disambiguating by
selecting the other same-placeholder Selects first). Plain `<Input>` fields
and native-label-wrapped `<Checkbox>` (e.g. step3's Program Services grid,
where the `<label>` literally wraps the `Checkbox`) are unaffected —
`getByLabel` works fine for those.

**Environment note — the local Docker/Postgres dev stack can become fully
unresponsive under host disk pressure, blocking e2e execution.** Mid-session,
`df -h /` showed the host root volume at 100% capacity (single-digit MB free).
`docker ps`, `docker logs`, `psql`, and the `pg` npm client all hung
indefinitely (TCP connect succeeded instantly; the Postgres wire-protocol
handshake never completed) — consistent with the Postgres container being
disk-starved rather than a code or driver bug. The host later freed up several
GB on its own, but `docker`/Postgres remained unresponsive afterward, implying
Docker Desktop's own backing store needed a restart, which isn't something a
test agent can trigger. **When this happens, e2e specs cannot be run live in
this session** — write/fix them for correctness (lint + `tsc --noEmit` clean,
`npx playwright test --list` succeeds) and say so explicitly, rather than
silently skipping the attempt. Escalate disk-space/Docker-daemon health to the
user/orchestrator; it is an infra issue, not a product bug.

**New/updated test files this session:**
- `src/app/actions/onboarding-complete.test.ts` — extended: step4 manager-role
  privilege-escalation matrix (owner/worker-role/garbage all skipped, valid
  manager roles create invites, mixed-batch dedupe), `FacilityDocument.createMany`
  wiring for step2 uploads, empty/omitted step4+step5 still completes.
- `src/app/actions/invite.test.ts` — extended: `'exists'`/`'resent'` statuses
  (previously untested), a 5-row mixed-batch (valid manager + valid worker +
  invalid role + duplicate-email-keeps-first-role + existing-member), and
  seat-cap interaction with a mixed batch (forbidden rows never consume a seat;
  already-known emails don't count toward new-seat math).
- `src/lib/staff-csv.test.ts` — added full coverage for
  `extractManagerInvitesFromRows`/`buildManagerCsvTemplate` (previously zero
  tests existed for the manager-CSV path): header-order detection, role-token
  normalisation, unrecognised/missing role → `''` (not an error), row cap.
- `src/app/actions/onboarding-documents.test.ts` — new file (first test for
  this module). Tenancy fence for `deleteOnboardingDocument`: rejects a
  different user's `onboarding/{userId}/` prefix and a same-prefix-string
  collision (`user-1` vs `user-10`); confirms the filename sanitizer strips `/`
  (so a filename can't inject an extra path segment) — note a literal `..` in
  the sanitized name is harmless since cloud object-storage keys are flat
  opaque strings with no directory resolution, so don't assert `not.toContain('..')`.
- `src/lib/rbac/roles-matrix-config.test.ts` — added supervisor/hr/
  clinicalDirector row spot-checks (previously only owner/finance/student were
  covered).
- `src/app/dashboard/(main)/settings/page.test.tsx` — new file, follows the
  `billing/page.test.tsx` async-Server-Component gate pattern: owner-only
  render vs. access-denied card for the other 4 admin roles, "no organization"
  state, and team-member/pending-invite merge shaping.
- `src/components/dashboard/DashboardLayoutClient.test.tsx` — extended with the
  owner-only Settings nav-link gate (independent from the pre-existing
  billing.read gate).
- `src/app/actions/facility.test.ts` — added `name`/`type` field coverage for
  `updateFacility` (the Settings Facility-tab extension had zero coverage for
  these two new fields).
- New/updated e2e specs: `tests/e2e/onboarding-wizard.spec.ts` (new — 5-step
  happy path + DB assertions),  `tests/e2e/staff-invite-flow.spec.ts` (new —
  the submit→success path jsdom can't reach, see [[org-facility-split-test-patterns]]),
  `tests/e2e/settings-page.spec.ts` (new), `tests/e2e/rbac-invite-roles.spec.ts`
  (fixed — modal now requires typing an email + clicking Continue before the
  role selector exists at all; previously assumed the selector was visible
  immediately on modal open).

**Left deliberately untested:** `src/lib/create-auth-instance.ts`'s new
fire-and-forget `recordLoginTimestamp` (lastLoginAt write) — the whole file has
zero existing unit tests (large NextAuth config, would need substantial new
scaffolding), and the call itself is error-swallowed/logged-only so it cannot
break login even if broken. Flagged as a pre-existing gap, not fixed here.

Related: [[project-test-framework]], [[rbac-8-worker-role-split]],
[[org-facility-split-test-patterns]], [[join-invite-critical-fix-regression]],
[[signup-owner-only-e2e-env]].
