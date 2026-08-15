---
name: vitest-cpu-contention-flake
description: A full vitest run can spuriously fail a single unrelated test with a 5000ms timeout when run concurrently with other heavy background processes (tsc, lint, build); the same file passes 100% both in isolation and in a clean full run
metadata:
  type: project
---

During the multi-facility UI-wave validation session (2026-08-11), a full `npx vitest run`
executed while `npx tsc --noEmit`, `npm run lint`, and `npm run format:check` were also
running in parallel background shells produced one failure:
`src/lib/enrollment/create-batch.test.ts` — `DIVERGENCE: entries positioned AFTER the failing
one are committed on the batched path but never attempted on the sequential path` — with
`Test timed out in 5000ms`.

That file was last modified 2026-08-07 (untouched by the wave under test) and passed 10/10
both in isolation (`npx vitest run src/lib/enrollment/create-batch.test.ts`, ~7s) and in a
subsequent clean full run with no concurrent background load (172 files / 2745 tests, all
green, ~36s). This confirms it was CPU-contention flake from running vitest alongside other
heavy CPU-bound checks, not a real regression or a flaky test in isolation.

**How to apply:** if `npm run test` / `vitest run` is launched concurrently with tsc/lint/build
in separate background shells (a common pattern for parallelizing a validation pass) and a
single, unrelated test times out, re-run the full suite alone (no concurrent background jobs)
before concluding it's a regression — don't route a single-timeout failure straight to
`code-ninja` without that isolation check first. This is a different failure mode from
[[full-e2e-suite-serial-flakiness]] (that one is Playwright/e2e-specific and about specs that
only fail in a long serial run, not about resource contention with sibling processes).
