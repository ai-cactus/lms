---
name: full-e2e-suite-serial-flakiness
description: course.spec ENG-022, quiz.spec ENG-020, and all 3 quiz-retake-attestation tests fail when run as part of the FULL 29-file suite (--workers=1, ~14min) but pass 100% in isolation — pre-existing cross-spec contamination, not diff-caused
metadata:
  type: project
---

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
