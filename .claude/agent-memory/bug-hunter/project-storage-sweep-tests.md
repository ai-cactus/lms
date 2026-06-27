---
name: project-storage-sweep-tests
description: Test files and patterns for orphaned-GCS-object cleanup (abort-cleanup + sweep worker)
metadata:
  type: project
---

Test files added for the Phase-1 abort-cleanup and reconciliation sweeper:

- `src/app/api/system/video-courses/upload/route.test.ts` — 15 tests covering auth, validation, 201 happy path, 499 abort-cleanup (including deleteFile-rejects resilience), 500 uploadFile-throws path.
- `src/lib/storage/gcs-provider.test.ts` — extended with `GCSProvider.list` describe block (4 new tests: correct URI/createdAt mapping, NaN-safe fallback, empty result, prefix forwarding).
- `src/lib/storage/minio-provider.test.ts` — new file, 5 tests: stream data+end→items, nameless entries skipped, missing lastModified fallback, stream error→rejects, prefix+recursive args.
- `src/lib/storage/index.test.ts` — new file, 4 tests for `listFiles`: GCS-throws→MinIO-only+warn, both-succeed→combined, GCS-unconfigured→MinIO-only, no spurious warn when GCS not configured.
- `src/lib/queue/video-sweep-worker.test.ts` — new file, 16 tests for `runVideoSweep` (grace filter, three-column reference-set including courseArtifact guard, deletion, dry-run, partial errors, normalized-path lifecycle) and `getVideoSweepWorker` (disabled flag, singleton).

**Key patterns used:**
- `vi.useFakeTimers()` + `vi.setSystemTime(NOW_MS)` for deterministic grace-period math in sweep tests.
- `flushMicrotasks = () => new Promise(r => setTimeout(r, 0))` for MinIO stream event timing (wait for ensureBucket's async await to complete before emitting stream events).
- `Object.defineProperty(file, 'size', { value: N })` to trigger the 413 size check without allocating hundreds of MB.
- `vi.resetModules()` in `index.test.ts` beforeEach to flush the `_gcs`/`_gcsInitialised` singleton between tests; all imports are dynamic inside test bodies.
- `delete globalThis.__videoSweepWorker` in beforeEach/afterEach to reset the Worker singleton between `getVideoSweepWorker` tests.
- For stream-based tests (MinIO), `mockListObjectsV2` must be set up BEFORE `provider.list()` is called; `flushMicrotasks()` is needed after calling `list()` and before emitting events.
