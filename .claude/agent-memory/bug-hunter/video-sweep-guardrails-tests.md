---
name: video-sweep-guardrails-tests
description: video-sweep-worker.test.ts / storage/index.test.ts — empty-ref-set guardrail silently invalidated old "setupEmptyRefs + aged object" tests; opt-in flag test fixture trap
metadata:
  type: project
---

`runVideoSweep` (src/lib/queue/video-sweep-worker.ts) and `listFilesForActiveBackend`
(src/lib/storage/index.ts) gained production-incident guardrails (prod GCS videos
deleted twice by the sweeper running with prod creds in a non-prod env). Regression
suite lives in src/lib/queue/video-sweep-worker.test.ts and src/lib/storage/index.test.ts.

**Gotcha 1 — a new guardrail silently broke old fixtures, not just new tests.**
The pre-existing test helper `setupEmptyRefs()` (empty DB reference set) was used
throughout the old suite whenever a test didn't care about references. Once the
empty-reference-set guardrail landed (`referencedUris.size === 0 && aged.length > 0`
→ abort, delete nothing), every *existing* test that combined `setupEmptyRefs()`
with an aged (`OLD`) object started silently asserting the wrong thing (it would
now abort instead of deleting) even though nothing about those tests' *intent*
changed. Added a second helper, `setupUnrelatedRef()`, that seeds one lesson
reference to a URI not used anywhere else in the test, keeping `referencedUris.size`
non-zero without affecting orphan detection — swapped it in wherever a test lists
aged objects but isn't itself testing the empty-ref guardrail.
**How to apply:** when a new "abort if reference set/condition X is empty/zero"
guardrail lands on any sweep/reconciliation worker, audit every existing test that
uses an "empty state" fixture alongside data that would now trigger the new
guardrail — don't just add tests for the new behavior.

**Gotcha 2 — opt-in flag flip changes what "absent" means.**
`getVideoSweepWorker()` changed from opt-out (`VIDEO_SWEEP_ENABLED !== 'false'` →
runs) to opt-in (`VIDEO_SWEEP_ENABLED === 'true'` exactly → runs). Old tests that
did `delete process.env.VIDEO_SWEEP_ENABLED` and expected a Worker now get `null`.
Any refactor from opt-out to opt-in (or vice versa) flips the meaning of "env var
unset" in existing tests — check for that specifically, don't assume unset ≡ old
default.

**Fire-and-forget promise in a sync function:** the disabled path calls
`void videoSweepQueue.removeJobScheduler(id).catch(...)` without awaiting. To assert
the `.catch` branch's error log under `vi.useFakeTimers()`, do NOT use `vi.waitFor`
(it polls via timers, which stay frozen) — flush microtasks directly with
`await Promise.resolve()` (twice) since `.catch` runs as a promise microtask, not a
timer callback.

Full suite after these changes: 138 files / 1935 tests, all green
(`npm test` = `vitest run`).
