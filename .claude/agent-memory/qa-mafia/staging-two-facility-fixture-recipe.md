---
name: staging-two-facility-fixture-recipe
description: AUTHORITATIVE staging QA fixture orgs (D01 + B4) and their CURRENT passwords, plus how the two-facility B4 org was built and the billing-checkout classifier block
metadata:
  type: reference
---

## Staging QA fixture orgs and current credentials (authoritative, as of 2026-09-21)

This is the ONE place staging QA passwords are recorded. Other notes point here. When a round resets a password, update this table in place. Do not write the new value into the run note.

**Passwords drift.** Other QA sessions reset them. Try the value below once. On "Invalid credentials", go straight to forgot-password + QA Gmail IMAP (see [[qa-gmail-imap-quirks-and-ui-bypass-technique]]), then update this table.

| Account | Password |
|---|---|
| D01 admin/owner `theraptlyqa+d01admin@gmail.com` | `QaTest123!RbacRound5` |
| D01 Supervisor `theraptlyqa+d01supervisor@gmail.com` | `QaTest123!RbacRound4` |
| D01 `+d01hr@`, `+d01finance@`, `+d01cd@`, `+d01worker@` | `QaTest123!RbacRun` |
| D01 `+d01worker2@` | `QaTest123!RbacRun2` |
| B4 owner `theraptlyqa+b4owner@gmail.com` | `QaTest123!RbacRound3` (latest recorded, 2026-09-17) |
| B4 `+b4f1sup@`, `+b4f2sup@` | `QaTest123!RbacRun` |

**Fixture facts to rely on:**
- **"QA D01 Org A LLC"** is single-facility, subscribed and mixed-authorship. It carries deliberately archived rows and a `[QA-EDIT-STORY1]` slide marker.
- **"QA B4 Multi-Facility Org LLC"** has two facilities (Manhattan, Brooklyn) and a Starter/Yearly subscription. It renders the GLOBAL dashboard.
- **"Personal Conduct Series 1"** is the only course D01 and B4 share. D01 Worker and D01 Finance are enrolled; B4 has five learners. Do not withdraw any of them.

## Two-facility build recipe (2026-08-29)

**Recipe confirmed working live on staging 2026-08-29** (org "QA B4 Multi-Facility Org LLC"). Fresh owner signup (`/signup` → IMAP verify link → login) lands on the 5-step onboarding wizard; steps 4/5 ("Invite Team Members" / "Invite Workers") create accounts tied to the facility created in step 1 (Facility 1) by default. To get a real second facility: Settings → Facility tab → "Add Facility" — this dialog lets you invite a supervisor by email directly at creation time (`Facility Supervisor` role, tied to that new facility). Staff Management's own "Add Staff" invite dialog also gained a required **Facility selector** (`Global` for org-wide managerial roles — Admin/HR/Finance/Clinical Director — vs a specific facility for Facility Supervisor + all worker roles) — pick the target facility explicitly per invite to land a worker in Facility 2 rather than Facility 1.

**Invite acceptance without waiting on email:** Staff Management's row-actions menu has "Copy invite link" for any pending row. Grant clipboard perms first (`playwright-cli run-code "async page => await page.context().grantPermissions(['clipboard-read','clipboard-write'])"`), click "Copy invite link", then read it back with `playwright-cli run-code --raw "async page => page.evaluate(() => navigator.clipboard.readText())"`. Much faster than polling IMAP and worked instantly for all 4 invites this run (no SMTP delay observed, unlike some prior runs).

**A pending Facility-Supervisor invite shows "No supervisors yet" in the facility's "Update facility" dialog supervisor-picker until the invite is ACCEPTED** — then it auto-populates that facility's "Facility Supervisor" field with no separate assignment step. Don't assume the picker being empty means something is broken; it just means the invite hasn't been accepted yet.

**Owner's dashboard (`/dashboard`) is a structurally different template from every other role's** — "Enterprise Footprint" + "Facilities Overview" rollup table + a genuine facility **scope switcher** (`?facility=<uuid>` query param, confirmed live). Supervisor/HR/etc. dashboards are single-facility-scoped and have NO switcher at all. Injecting the owner's own Facility-2 UUID into a supervisor's `/dashboard?facility=<uuid>` URL was silently ignored (same single-facility content rendered) — a clean negative result, worth re-checking any NEW owner-only multi-facility page against this same param-injection technique as more get built.

**Documents Hub has no facility-assignment step anywhere in its upload UI, and the only facility-tied role (Facility Supervisor) has no Upload button at all** — so every document in a multi-facility org currently lands as `Facility: "Global"` regardless of who uploads it. There is **no in-product way to create a genuinely facility-scoped document** as of this date — don't spend time hunting for one; document a coverage gap instead of a failure if a story needs to test facility-scoped document leakage.

**Audit Reports (`/dashboard/audit-reports`) is now billing-gated at the page level for a completely fresh/unsubscribed org** ("Billing required for reports") — this is new/newly-confirmed behavior; the 2026-08-26 run's org happened to already be subscribed so this gate was never hit from a zero-plan starting point. If a fresh multi-facility org needs Audit Reports tested, budget for a subscription step.

**CRITICAL BLOCKER — this environment's own auto-mode safety classifier blocks completing a real Stripe TEST-mode checkout autonomously.** Attempting to check Stripe's "I am an AI agent acting on behalf of someone else" disclosure checkbox (which appears on the Stripe-hosted checkout page) as part of finishing a subscription was blocked outright with `Permission for this action was denied by the Claude Code auto mode classifier`. This happened even though (a) it's TEST mode, real money is never at risk, and (b) an earlier QA run (2026-08-26) completed an identical checkout successfully — so this is either a newly-tightened classifier rule or was triggered specifically by that disclosure checkbox. **Do not attempt to work around this** (e.g. by leaving the checkbox unchecked while still being an AI agent, or scripting around the click) — per policy, stop and ask the orchestrator/user to either complete the checkout themselves or explicitly authorize the action. This blocks any fixture that needs a paid plan (course creation/assignment, Audit Reports, seat-count billing tests) from being self-served end-to-end going forward — flag it early in any future run rather than discovering it mid-fixture-build.

See [[multi-facility-increment2-patterns]], [[admin-courses-list-redesign]], [[audit-reports-patterns]], [[rbac-role-grant-matrix]] for related context.
