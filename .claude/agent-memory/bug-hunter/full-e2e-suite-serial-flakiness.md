---
name: full-e2e-suite-serial-flakiness
description: course.spec ENG-022, quiz.spec ENG-020, reminders REM-001/TC-015/TC-018, and quiz-retake-attestation tests can all fail together — root cause identified 2026-08-14 as stale local-DB fixture rows surviving across repeated manual runs, NOT full-suite-only ordering; seed.ts documents the exact reset
metadata:
  type: project
---

**Update 2026-08-14 (course-creation-wizard certification, branch multi-facility): found the
actual mechanism**, not just a correlation. These specs share a small set of hardcoded-UUID seeded
enrollments/course-assignment rows (Sarah `...881`, Test Worker `...882`, Nurse `...885`, Larry
Lockout `...886`, Rita Retake `...887`, plus the single `CourseAssignment` row for
`E2E Compliance Training`). Running any of these specs to a **successful** completion mutates that
shared row (locks an enrollment, writes a `quiz_attempts` row, flips the assignment to role-mode,
etc.) — and nothing resets it before the next run against the same **persistent local Postgres**.
`prisma/seed.ts` (search `ENROLLMENT_SARAH_ID` and the comment above its `quizAttempt.deleteMany`
block, ~line 528) *already documents this exact failure mode verbatim*: "a leftover QuizAttempt
... would make the learn page restore straight into the ACTIVE quiz view ... so 'Proceed to Quiz'
never renders and the suite is no longer safely re-runnable" — and resets 5 enrollment IDs +
deletes the course's `CourseAssignment` row before every seed. In this session, rows dated
`2026-08-11` (three days before the session) were still present, proving this isn't reruns from
*this* session alone — it's ambient debris from **any** prior local run that never got reseeded.

**Symptoms observed from stale rows** (confirms/extends the 2026-08-04 note below):
- `course.spec.ts` ENG-022: strict-mode violation, 2 "Test Worker" rows (leftover retake enrollment
  from a prior successful ENG-022 run — `retake_reason = 'Granted after review — E2E regression
  test'`).
- `reminders.spec.ts` REM-001/TC-015/TC-018: `#assign-input` never appears because the Assign page
  now defaults to whichever mode ("Specific people" vs "A whole role") the *existing*
  `CourseAssignment` row was last left in (a prior `TC-016` run sets `target_roles`); TC-015's own
  "Due <date>" assertion can additionally fail because `enrollUsers`/`createEnrollmentForUser`
  silently no-ops (`status: 'alreadyEnrolled'`) on a member who already has *any* enrollment — it
  never updates `dueAt` on a re-assign.
- `quiz.spec.ts` ENG-020 / `quiz-retake-attestation.spec.ts`: exactly the failure mode seed.ts's
  own comment predicts — a leftover `quiz_attempts` row skips straight past the lesson content.

**The fix — reproduce seed.ts's reset directly in SQL** (no seed script is wired into
`package.json`, so `npx prisma db seed` isn't available; this session ran the equivalent
statements against `docker exec lms-dev-db psql`):
```sql
delete from quiz_attempts where enrollment_id in (
  '88888888-8888-4888-8888-888888888881', -- Sarah
  '88888888-8888-4888-8888-888888888882', -- Test Worker
  '88888888-8888-4888-8888-888888888885', -- Nurse
  '88888888-8888-4888-8888-888888888886', -- Larry Lockout
  '88888888-8888-4888-8888-888888888887'  -- Rita Retake
);
-- then reset each enrollment's status/progress/score/*_at/retake_of/retake_reason to the pristine
-- values in seed.ts's own `update:` block for that ID (they differ per worker — read the file,
-- don't guess), delete any `retake_of`-chained rows, and:
delete from course_assignments where course_id = '44444444-4444-4444-8444-444444444441';
```
After this reset, all of the above passed cleanly (course.spec.ts 4/4, quiz.spec.ts 1/1,
quiz-retake-attestation.spec.ts 3/3 — the one remaining single-test failure in that file was a
genuine transient race, reproduced 0/1 on immediate rerun, unrelated to fixture state).

**How to apply:** before trusting a full-suite (or even a 2-3-file) local run's failures in any of
these specs as a real regression, check whether the shared fixture rows are stale first — this is
now the *first* thing to check, cheaper than the git-stash/CI-diff comparison below. If in doubt,
apply the SQL reset above (or run the real seed script if one gets wired up) and rerun before
concluding a regression exists.

**2026-08-04 original note** (root cause was not yet understood then — the "full-suite-only,
ordering-related" framing below is superseded by the fixture-staleness explanation above, but the
verification methodology is still a good fallback when the SQL reset doesn't fully explain a
failure):

Observed 2026-08-04 while verifying the onboarding step3 redesign (feat/onboarding+video-list):
a full local `npx playwright test --workers=1` run (110 passed / 6 failed / 3 skipped, ~14min)
failed 6 tests — 1 was the genuine onboarding rehydration bug (since fixed by code-ninja in
`src/app/onboarding/step3/page.tsx`), but the other 5 were:
- `course.spec.ts` ENG-022 (admin assigns retake) — `strict mode violation: ... resolved to 2
  elements` for the "Test Worker" row's Row-actions button (two matching rows present).
- `quiz-retake-attestation.spec.ts` — all 3 tests: lockout test got 403 on attempt 1 (should be
  200), and both "self-service Retake Quiz" + "nurse attest" tests timed out waiting for
  'Proceed to Quiz' / 'Start Quiz' buttons that never appeared.
- `quiz.spec.ts` ENG-020 — same 'Proceed to Quiz' timeout.

**Why:** Verified via two independent checks (per bug-hunter isolation-testing practice): (1) the
latest CI run on `dev` at the exact same merge-base commit (406dceb, run 30837331822) shows the
E2E job green — all these specs pass in CI's fresh ephemeral containers; (2) `git stash -u` back
to that same commit, rebuild, reseed, and running just these 3 spec files together
(`course.spec.ts quiz.spec.ts quiz-retake-attestation.spec.ts`) passed 6/6 in ~20s with NO diff
applied. This isolates the cause to cross-spec state contamination / ordering effects that only
surface across the full ~14-minute serial run against this session's long-running local Docker
containers — not a regression from any particular diff, and not reproducible by running the
affected specs alone.

**How to apply:** when a full-suite local run shows failures in `course.spec.ts` ENG-022,
`quiz.spec.ts` ENG-020, or `quiz-retake-attestation.spec.ts`, don't assume the current diff broke
them — cheaply re-verify first: run the failing spec(s) alone (or `git stash` to the merge-base
and rerun) before reporting a regression. This complements the existing quiz-retake-attestation
flakiness history (S74) and the merge-base test-contamination gotcha noted in
`promote-single-feature-to-main-via-cherry-pick.md` (auto-memory) — this is a distinct instance of
the same family of full-run-only flakiness, specific to quiz/course specs sharing worker fixtures
(lockoutWorker, retakeWorker, nurse) across many preceding spec files in one long serial run.
