---
name: phase3-quiz-retake-attestation-tests
description: Phase 3 QA fix test patterns — retakeQuiz() unit tests, WorkerCourseList badge tests, and the quiz-retake-attestation e2e spec that caught a real learn-page UI bug
metadata:
  type: project
---

Covers `src/app/actions/course.retake-quiz.test.ts`, `src/components/worker/WorkerCourseList.test.tsx`,
and `tests/e2e/quiz-retake-attestation.spec.ts`, guarding four Phase 3 fixes:
`retakeQuiz()` no longer mutating quiz-attempt history, `isWorkerRole()` replacing
a strict `role === 'worker'` check for the attestation gate, and the "Attempt N"
counter logic in both `learn/[id]/page.tsx` and `WorkerCourseList.tsx`.

**How to apply:**

- **Found a real, isolated UI bug via e2e before code-ninja's fix landed — worth
  the API-request-probing technique.** `retakeQuiz()`'s server-side reset was
  correct, but `learn/[id]/page.tsx`'s restore-on-load logic routed to the quiz
  REVIEW screen whenever any completed attempt existed with no active draft —
  with no branch for "just retook, needs Start Quiz." Confirmed the exact root
  cause (not just "UI looks stuck") by driving `/api/quiz/[id]/start` and
  `/submit` directly via `page.request.post()` (shares the browser's session
  cookies) to prove the *server* contract worked standalone, independent of the
  broken client restore branch — this isolates "is it the API or the client" in
  minutes instead of guessing from screenshots. Reusable technique for any
  suspected client-vs-server split bug.
- **`E2E_TEST_BYPASS_RATE_LIMIT` must be exported into BOTH the dev-server shell
  AND the `npx playwright test` shell separately** — they're different Node
  processes with independent `process.env`. `tests/e2e/mfa-login-consolidation.spec.ts`'s
  rate-limit test has its own `test.skip(process.env.E2E_TEST_BYPASS_RATE_LIMIT === 'true', ...)`
  guard specifically for this, but that guard only works if the flag reached the
  *test runner* process too — exporting it only when starting `npm run dev` lets
  the server silently bypass rate limiting while the test still runs for real
  and fails on "Too many code requests" never appearing. Always export identical
  env vars to both processes for local e2e runs, not just the server.
- **`tests/e2e/billing-stripe-plan-prices.spec.ts`'s Starter-card price test is a
  pre-existing, unrelated flake** — `locator('div.relative').filter({ has:
  locator('#plan-btn-starter') })` is a strict-mode violation locally (matches
  both the page wrapper div AND the plan card, both having class `relative`).
  Confirmed unrelated to Phase 3 (no files in that feature area were touched);
  don't waste time re-diagnosing it against future changes in this area unless
  asked to fix billing tests specifically. See [[stripe-billing-prices-ssot-tests]].
- **Adding a new e2e journey often needs a brand-new seed fixture, not reuse of
  an existing one.** `prisma/seed.ts` fixtures are purpose-built and mutate
  state (enrollment status, quiz attempts) during their own spec — reusing one
  across two specs that both need to drive the SAME enrollment's attempt history
  causes cross-spec contention (confirmed: reusing `larry.lockout` for both an
  API-driven "drive to locked" spec and a UI-driven "retake once" spec caused the
  second to hang, because the first had already locked the enrollment). Added
  three new fixtures this session (`nina.nurse@test.com` role `nurse`,
  `larry.lockout@test.com`, `rita.retake@test.com`, all role `front_desk_admin`
  except nurse), each with its own dedicated enrollment ID, progress:100 /
  in_progress / zero quiz attempts so specs land straight on the quiz intro
  screen. Follow the existing idempotent-upsert + quizAttempt-cleanup pattern
  (see sarah/worker fixtures) when adding more.
- A `next dev` cold-start on the very first request in a probe/test run can
  cause an early `getByRole(...).click()` to time out even though the button IS
  reachable — reproduced once, passed cleanly on retry alone. Don't treat a
  single early-step timeout in an otherwise-correct flow as a real bug without
  first retrying against an already-warm server.
