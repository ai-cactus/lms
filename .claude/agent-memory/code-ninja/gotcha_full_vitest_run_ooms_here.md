---
name: full-vitest-run-ooms-here
description: A bare `npx vitest run` is OOM-killed (exit 137) on this box; shard it to actually verify the full suite instead of reporting a partial run
metadata:
  type: project
---

`npx vitest run` over the whole suite is **OOM-killed on this machine** — it dies with bare `exit code 137` and no test output, which reads like a crash rather than a memory limit. `--maxWorkers=2` does not save it.

**Why:** ~365 test files × jsdom environments exceeds the box's memory. Confirmed 2026-09-23; the user's own notes already record "the full suite gets OOM-killed here".

**How to apply:** run it in shards, single-worker, and add the counts up:

```bash
npx vitest run --shard=1/4 --maxWorkers=1   # repeat for 2/4, 3/4, 4/4
```

Each shard takes ~2 min (≈8 min total) and reports its own file/test counts. Four shards covered 365 files / 6231 tests. Do **not** substitute `npm run test:changed` and call the suite verified — Rule 21 wants the full suite, and sharding is how you actually get it here.

Two CLI details that waste a round-trip otherwise: `--poolOptions.threads.maxThreads` is **rejected** by this vitest (`CACError: Unknown option --poolOptions`); use `--maxWorkers`. And `npm run e2e:local` accepts several spec filenames at once, with `E2E_KEEP_UP=1` to leave the containers up between runs.

Related: [[build_typecheck_scope]].
