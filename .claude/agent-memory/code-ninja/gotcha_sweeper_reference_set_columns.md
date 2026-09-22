---
name: sweeper-reference-set-columns
description: Any new column that stores an object under system/videos/ MUST be added to the video sweeper's buildReferencedUriSet, or the sweeper deletes those objects
metadata:
  type: project
---

The orphan sweeper (`src/lib/queue/video-sweep-worker.ts`, `buildReferencedUriSet`) lists EVERYTHING under
`system/videos/` and deletes any aged object whose URI is not in its reference set. Until BUG-17 (2026-09-22)
the set held only the video columns, so every poster still (`system/videos/posters/`, written by
scripts/transcode-worker.ts into `Lesson.videoPosterStorageUri` / `Course.previewPosterStorageUri`) looked
orphaned. BUG-17 added the poster columns and `Course.thumbnailStorageUri` (`system/videos/thumbnails/`).

**Why:** the sweeper's guardrails (opt-in flag, APP_URL interlock, dry-run default, delete cap) defend against a
misconfigured environment, not against a column missing from the query. In prod the unprotected posters also
inflate the orphan count past `VIDEO_SWEEP_MAX_DELETES`, which aborts the run entirely.

**How to apply:** whenever you add a storage-URI column whose objects land under `system/videos/`, widen the
matching `findMany` (OR on the new column, add it to `select`) and add it to the set, plus a test in
video-sweep-worker.test.ts. Course reads there must stay on `rawPrisma` (archived rows keep their files, Q24).
Related: [[gcs-video-loss-sweeper]].
