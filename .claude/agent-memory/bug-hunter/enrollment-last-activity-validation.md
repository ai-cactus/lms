---
name: enrollment-last-activity-validation
description: Validated feature/enrollment-last-activity (2026-09-26) — implementer's tests were thorough; only gap was objectContaining hiding admin non-stamp regressions
metadata:
  type: project
---

Validated `Enrollment.lastActivityAt` (dormant-staff engagement tracking) on
2026-09-26. The implementer's own test suite (13 files touched) was unusually
thorough: every learner write site (progress route, video progress, quiz
start/save/submit, attestCourse, startCourse, retakeQuiz, requestCourseRetry)
already had an explicit refusal-path assertion that no stamp occurred, and
`create.ts` already had a direct `not.toHaveProperty('lastActivityAt')` check
for the admin-assign path.

**The one systematic gap**: `assignRetake` (src/app/actions/course.ts) and the
renewal creation in `src/lib/reminders/sweep.ts` are also admin/sweep-only
non-stamp sites, but their existing tests asserted the created `data` with
`expect.objectContaining({...})` — which passes even if a future
`lastActivityAt: new Date()` were added to that call, since
`objectContaining` ignores extra keys. Added direct
`expect(data).not.toHaveProperty('lastActivityAt')` assertions to both
(course.assign-retake.test.ts, sweep.test.ts). **Lesson**: when auditing
"never stamps X" claims backed only by `objectContaining` assertions, they
don't actually prove absence — check for a direct property-absence assertion,
not just that the site is "covered by a test".

Also added two belt-and-suspenders `enrollment.updateMany`/`enrollment.update`
not-called assertions on quiz save (ownership 403, archived 403) and quiz
submit (no-attempts-remaining 403) refusal paths — logically already
guaranteed by an unconditional early `return` before the stamp call, but now
explicit per the site-by-site audit.

e2e: `tests/e2e/quiz-retake-attestation.spec.ts` (3/3 passed) exercises the
live quiz start/save/submit + retakeQuiz + attestCourse paths against a real
DB with the new migration applied — good confirmation the migration/column
don't break anything live. `tests/e2e/video-playback.spec.ts` self-skipped
(8/8) because `tests/e2e/fixtures/sample-lesson.mp4` does not exist in this
worktree — pre-existing, unrelated to this feature (see
`generate-video-fixture.sh`; the fixture was apparently never generated and
committed by anyone). Flagged to the orchestrator, not fixed here.

Full sharded suite (4 shards, `--maxWorkers=1`): 379 files / 6377 tests, all
green. Production build succeeded (72 pages). Typecheck/lint/prettier clean.
