---
name: role-target-picker-pr2-test-patterns
description: RoleTargetPicker (draft/live D5-D6) test patterns, two e2e gotchas, and the mis-scoped regression sweep that let a broken spec ship from this same branch
metadata:
  type: project
---

PR-2 of `feature/role-target-picker` (2026-09-11): `src/components/dashboard/enrollment/RoleTargetPicker.tsx` is the one shared chip-input role picker — `draft` mode stages a selection for a host form (no confirm on removal), `live` mode writes straight through to `setRoleAssignmentTargets` and gates removal behind an `AlertDialog` naming `enrolledCount` (D6 soft revoke — removing a role never touches existing enrollments, only stops future auto-enroll).

**A handoff note claimed `RoleTargetPicker.test.tsx` was still missing — it wasn't.** It already existed on disk, uncommitted, fully covering all 7 required scenarios (draft-vs-live confirm, cancel, server-refusal-reverts-and-surfaces-inside-the-dialog, None/D3 mutual exclusivity, D4 EVERYONE-group expansion, all-13-roles-rendered, canRevoke:false lockout) — 13/13 green as found. **Lesson:** always check the actual file tree before trusting a "still missing" list in a resumed/handoff task; a prior cut-off run can leave real, uncommitted work that the summary never mentioned.

**Two e2e gotchas hit writing `tests/e2e/course-role-assignment.spec.ts`:**
1. **pg does not parse a custom Postgres enum array column** (`target_roles "UserRole"[]`) the way it parses built-in `text[]`/`int[]` — a raw `SELECT target_roles FROM course_assignments` returns the literal string `"{nurse}"`, not `['nurse']`, so `toEqual(['nurse'])` fails with a confusing "deep equality" diff. Fix: cast in SQL — `SELECT target_roles::text[] AS target_roles ...` — then pg parses it into a real JS array.
2. **RoleTargetPicker's open dropdown is an absolutely-positioned overlay (`z-50`) that can cover page content below it** (the assign page is short enough that the open role list overlaps "Assign Course"). Clicking a covered button doesn't throw — Playwright's default actionability retry has no per-action timeout here, so it silently retries until the whole test's `test.setTimeout` fires, surfacing only as "Test timeout of 180000ms exceeded" with no actionable stack frame. Fix: after ticking a role, close the dropdown by clicking something clearly outside `RoleTargetPicker`'s container (e.g. the page's own `<h1>`) before interacting with anything further down — the component closes on any `mousedown` outside its ref, there is no Escape-key handler.

Also reconfirmed: `lms_e2e` (port 5442, docker-compose.e2e.yml) can have its containers already `Up (healthy)` while the DB itself is completely empty (zero tables) — the compose containers being up says nothing about migration/seed state. Run `sh scripts/with-e2e-env.sh npx prisma migrate deploy` then `... npx prisma db seed` before trusting any e2e run against already-running containers.

**CORRECTION (2026-09-13) — I reported this branch green, and it wasn't.** It merged as PR #595 and shipped a broken `reminders.spec.ts` TC-016. Full story, including the second independent staleness in that same test, is in [[role-target-picker-stale-locator-sweep]]; do not re-derive it here.

What that file doesn't record is **why my own sweep missed it**, which is a separate cause from the CI-skips-e2e policy it blames. I derived the affected-test set by grepping for files that **import the changed modules**, ran 15 files / 174 unit tests, added my new e2e spec, and called it clean. That heuristic is structurally blind to e2e: a Playwright spec imports none of the changed source — it couples to the **rendered control** by role and accessible name, so no import-graph sweep can ever surface it, however thorough. **How to apply:** when a change swaps or removes a UI control, derive the e2e half of the affected set from the **outgoing** control's selectors (the old label text, `getByRole('option')`/`combobox`), not the new one's — and say "the unit suite is green", never "the suite is green", unless I actually ran the e2e specs that drive the touched screen.

See [[project-test-framework]] for the general Vitest setup and [[full-e2e-suite-serial-flakiness]] for the broader e2e-DB-state class of issue.
