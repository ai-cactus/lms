---
name: tier3-5.3-pr7-enrollment-batching
description: Test coverage + the one confirmed behavioral divergence for Tier 3 §5.3 PR-7 (createEnrollmentsForUsers, ENROLLMENT_BATCH_ENABLED), branch feat/more-performance commit d8067bd
metadata:
  type: project
---

Tested 2026-08-05. Two new files, 26 tests, all green (full suite: 158 files /
2290 tests green, no regressions):
`src/lib/enrollment/create-batch.test.ts` (algorithmic equivalence between
`createEnrollmentsForUsers` and a reproduced-verbatim sequential reference —
seat-limit force-fail, already-enrolled skip, no-duplicate-email guarantee for
both a repeated known email and a repeated unknown/invite email, mixed-batch
ordering, 50-60 holder scale, bounded-concurrency instrumentation, partial
launch-email-failure isolation, createNotification-throw abort) and
`src/app/actions/enrollment.batch-equivalence.test.ts` (wiring-level: real
`enrollUsers`/`assignCourseToRole` calls under `ENROLLMENT_BATCH_ENABLED`
unset/`'false'`/`'true'`, incl. unset-equals-false byte-for-byte check).

**One confirmed, reproducible BLOCKING divergence** (not a test-infra
artifact — pinned by a passing regression test,
`createEnrollmentsForUsers — partial-failure semantics > DIVERGENCE: entries
positioned AFTER the failing one are committed on the batched path but never
attempted on the sequential path`, in create-batch.test.ts): when a hard
failure occurs mid-batch (e.g. `createNotification` throwing for one entry),
the **sequential** path stops immediately — nothing after the failing index is
ever touched (no read, no write, no email). The **batched** path's worker pool
dispatches ALL groups up to `ENROLLMENT_BATCH_CONCURRENCY` (10) concurrently
BEFORE the failing group's error is observed, so for any batch with ≤10
distinct-email groups (i.e. most real usage), entries positioned AFTER the
failing one in input order still commit their enrollment — the overall call
still rejects, but the "committed" set differs: sequential = {everything up to
and including the failing entry's own enrollment write}; batched = {that
same set} ∪ {every other group that was already in flight}. Both paths honor
the documented "non-transactional, no rollback" contract for what DOES get
committed, but WHICH entries get committed on a hard-abort is not equivalent.
Reported to the orchestrator as a blocking finding for PR-7 — not fixed here
(bug-hunter does not touch product code); awaiting a fix-loop decision
(code-ninja) on whether this divergence is accepted as an inherent tradeoff of
bounded-concurrency batching (worth documenting explicitly) or needs
cancellation semantics added.

Also surfaced and confirmed via this work: [[vitest-concurrent-dynamic-import-mock-race]]
— a Vitest-only test-infra limitation discovered while first drafting these
tests (initial email-call-count assertions looked exactly like a second,
separate product bug before being traced to the test harness). Any future
test of concurrently-invoked code that dynamically `import()`s a mocked
module should read that memory first.
