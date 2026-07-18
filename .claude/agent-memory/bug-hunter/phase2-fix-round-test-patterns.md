---
name: phase2-fix-round-test-patterns
description: Test patterns, gotchas, and a real product bug found while testing Phase 2 (deadline-drop, role-target assignment, renewal re-trigger, ADMIN_PRE_DEADLINE_REMINDER, video mediaStatus, PHI attestation, quiz chunking) on branch fix/phase-02
metadata:
  type: project
---

## Environment gaps found (not code bugs)

- `server-only` was declared in `package.json` but absent from `node_modules` —
  `src/lib/billing-prices.test.ts` failed to even load ("Failed to resolve
  import 'server-only'") despite the test file already `vi.mock`-ing it (Vite's
  import-analysis plugin tries to resolve the bare specifier before the mock
  applies). Fix: `npm install`. Not a stale-mock issue — check `ls
  node_modules/<pkg>` before assuming a test file itself is broken.
- Docker Desktop was not running (WSL2) — `docker.exe compose -f
  docker-compose.dev.yml up -d db redis mailhog` after starting Docker Desktop
  from the Windows side (`"/mnt/c/Program Files/Docker/Docker/Docker
  Desktop.exe"`) and polling `docker.exe ps` in a background Bash task.
- `lms_e2e` Postgres database already existed on the shared `lms-dev-db`
  container (port 5433) alongside the dev `lms` DB — just needed `prisma
  migrate deploy` + `prisma db seed` against its own `DATABASE_URL`. MailHog is
  `theraptly-mailhog` in this repo's `docker-compose.dev.yml` (not
  `lms-e2e-mailhog` as an older memory says) but exposes the same 1025/8025
  ports, so it works as both dev and e2e SMTP sink without a second container.
- `.env` **does** set `AUTH_URL=http://localhost:3000` as of this session —
  the older memory claiming this trap was "resolved, .env no longer sets it"
  is stale. Always export `AUTH_URL=http://localhost:3005` (+ NEXTAUTH_URL/
  NEXT_PUBLIC_APP_URL/APP_URL) when running e2e locally; verify current `.env`
  content rather than trusting that memory.

## Mocking the two new sweep pre-passes (runRoleTargetReconcilePrePass, runRenewalRetriggerPrePass)

Both are internal (non-exported) functions in `sweep.ts`, reached only via
`runReminderSweep`. They share `prisma.courseAssignment.findMany` with two
different `where` shapes (`targetRole: {not: null}` vs `renewalCycle: {not:
'none'}}`) — route a single mock via `mockImplementation` inspecting
`'targetRole' in args.where` vs `'renewalCycle' in args.where`, don't rely on
call order between the two pre-passes.

**Critical gotcha**: when EITHER pre-pass's `courseAssignment.findMany` call
resolves `[]`, that pre-pass returns immediately (`if (assignments.length ===
0) return;`) WITHOUT ever calling `prisma.enrollment.findMany` — it does NOT
consume a slot in `enrollment.findMany`'s `mockResolvedValueOnce` queue. Since
`enrollment.findMany` is shared across role-target-reconcile's existing-check,
renewal-retrigger's candidates+related queries, AND Track A/Track B, an extra
placeholder value queued "for the pre-pass that will short-circuit" silently
shifts every subsequent `.mockResolvedValueOnce()` by one slot and corrupts
unrelated tests later in the file (not just the one you're writing) — Vitest's
`vi.clearAllMocks()` in `beforeEach` does NOT clear unconsumed queued
once-values, so the corruption leaks across tests until the queue drains.
Symptom: a test far from the one you just edited starts failing with a wildly
wrong received value. Fix: count exactly which prisma calls each pre-pass
ACTUALLY makes given your fixture (0 if its own `courseAssignment.findMany`
resolves `[]`) before writing the `mockResolvedValueOnce` chain.

`SWEEP_LADDER_STAGES` (5 SWEEP_STAGES + `ADMIN_PRE_DEADLINE_REMINDER`) means a
single-fire Track A test's `summary.skipped` count includes every OTHER stage
in the ladder that didn't match the target date that day — don't assert
`skipped === 0`/`=== 1` in a dry-run/tally-classification test; only assert the
counter for the outcome you're actually testing (`wouldSend`/`ladderSent`).

`createEnrollmentForUser` (mocked in most describe blocks) and
`createNotification`/`sendCourseLaunchEmail` (used only by the renewal
pre-pass, previously unmocked in `sweep.test.ts` because unreached by existing
tests) needed new `vi.mock()` blocks added — existing tests never exercised
these because `courseAssignment.findMany` defaulted to `[]`.

## Testing an async internal helper in a 'use server' file

`course-ai-v4.6.ts`'s Stage C quiz chunking (`planQuizChunks`,
`mergeQuizChunks`, `generateQuizV46`) was entirely internal/non-exported. A
`'use server'` module may ONLY export async functions (see the pre-existing
`assessCourseQuality` comment in `course.ts` — the same constraint). Since
`generateQuizV46` is already async, adding `export` to it alone (not the sync
helpers `planQuizChunks`/`mergeQuizChunks`, which would break the Next.js
build) is a minimal, behavior-preserving visibility change that unblocked
direct unit testing of the whole chunking orchestration (single-call vs
sub-batch planning, dedup+renumber, partial results, retry-once semantics)
without driving the full background pipeline. `planQuizChunks(n)` for n>20 is
NOT a balanced split — it's greedy `min(6, remaining)` per iteration, so
`planQuizChunks(25) = [6,6,6,6,1]`, not `[6,6,6,7]` — verify the actual chunk
plan before writing sub-batch-count assertions.

## Product bug found (reported, not fixed)

`src/app/dashboard/(main)/documents/[id]/page.tsx` line ~28 still gates the
individual document VIEWER page on exact `doc.userId !== session.user.id`,
never updated to org-wide scope. `getDocuments`/`renameDocument`/
`deleteDocument` in `documents.ts` WERE correctly updated for the approved
"Document Hub full parity" decision (`qa-reports/phase-2-fix-plan.md` line 5).
Net effect: an org admin sees/renames/deletes another admin's doc from the
LIST, but clicking into it to VIEW/preview 404s unless they're the uploader.
Confirmed via `git log` — this file has zero commits on `fix/phase-02`. Fix
direction: compare `doc.user.organizationId` to the caller's org (mirroring
`deleteDocument`), gated by `isAdminRole`, not exact `userId`.

Also documented (not fixed, low severity): `uploadDocument`'s server-side
`.doc` guard is `ALLOWED_MIME.includes(file.type) || ALLOWED_EXT.test(name)` —
an OR — so a `.doc` file with a spoofed `application/pdf` MIME type is
admitted. See `documents.test.ts`'s "documents that a .doc file with a spoofed
... MIME type is NOT blocked today" test, which pins current behavior with an
explanatory comment rather than asserting it's correct.

## E2E seed fixture additions (prisma/seed.ts)

Added for this round's e2e coverage: `admin2@test.com` (second org admin, for
Document Hub cross-visibility), a document owned by admin2, `Nadia Nearing`
(due in 3 days, for the status-tracker At-Risk/nearDeadline section — distinct
from `Olivia Overdue`'s always-≥7-days-overdue fixture), and `Walt Assignable`
(a worker with NO enrollment in the seeded course, so assign-flow specs enroll
him live via the UI rather than fighting a pre-seeded state).

**Found and fixed a real cross-spec pollution bug in the seed script itself**:
`reminders.spec.ts`'s assign-page tests (existing REM-001 plus this round's
new TC-015/016/018) all upsert the SAME `(organizationId, courseId)`
`CourseAssignment` row for the one seeded course. The seed script reset
Enrollment/QuizAttempt/Notification rows on every run but never reset
`CourseAssignment` — so a role-target assignment from one Playwright run
persisted into the next `db seed` + run cycle, and the Assign page defaulted
into "role" mode (`existingSettings?.targetRole` truthy) instead of "people"
mode, causing `#assign-input` to never appear and EVERY people-mode assign
test (including the pre-existing, unmodified REM-001) to time out. Fixed by
adding `prisma.courseAssignment.deleteMany({ where: { courseId: COURSE_ID }
})` to the seed script's reset block (schema's `onDelete: SetNull` on
`Enrollment.assignmentId` makes this safe — no orphaned FK, no cascade-deleted
enrollments). **Lesson**: any e2e spec that mutates a course-level singleton
row (not a per-user row) needs that singleton reset in the seed script, or
verify seed-script idempotency by running the suite TWICE in a row locally
before trusting a "passes once" result.

## Wizard's AI pipeline is unreachable in this sandbox

No Vertex AI credentials — the course wizard can't be driven past Step 2 (AI
document analysis) via the browser, and `uploadDocument`'s PHI scan always
fails closed on a live Vertex AI call, so live document UPLOAD e2e is also
blocked. Existing `course.spec.ts` (ENG-024) already works around this by
never advancing past Step 2. For the wizard's `createFullCourse` deadline-drop
regression (TC-015), tested the underlying delegation via the standalone
Assign page instead (same `enrollUsers`/`createEnrollmentForUser` code path
the wizard delegates to) — see `course.create-full-course.test.ts` for the
precise unit-level delegation-wiring proof, and `reminders.spec.ts`'s TC-015
for the e2e round-trip-to-the-worker's-UI proof.
