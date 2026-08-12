---
name: gotcha-video-sweep-env-interlock
description: Guardrails that live in the env file can't stop a copied env file — the video sweeper's destructive gates key on APP_URL, the one value a copy must change.
metadata:
  type: project
---

`.env.staging` carries the SAME `GCP_BUCKET_NAME` and the SAME `GCS_KEY_BASE64` as `.env.production` (verified by hash), so staging reads and writes the production bucket. That is the unclosed root cause behind production GCS videos being deleted twice (2026-07-16, 2026-07-21) by the orphan sweeper.

**Why the earlier guardrails weren't enough:** the opt-in flag, empty-reference-set abort, delete cap and single-backend listing all live in the same `.env` file that gets copied between environments — a copy brings the arming flags along with the bucket and credentials. `src/lib/queue/video-sweep-worker.ts` therefore now also requires `VIDEO_SWEEP_OWNER_APP_URL` to **exactly equal** `APP_URL`, and `VIDEO_SWEEP_DRY_RUN` defaults to dry-run unless it is exactly `'false'`. `APP_URL` is the interlock key precisely because a copied env file *must* change it or auth redirects and emailed links break loudly.

**How to apply:** Any future destructive background job (mass delete, bulk email, data purge) gets the same treatment — an enable flag alone is not a safety mechanism when env files are copied, and the fail-safe default for anything destructive is the harmless one. Also note the real fix is still outstanding at the ops layer: **the owning environment must be the only one holding write credentials for the bucket.** Code-level interlocks are a backstop, not a substitute. See [[deploy-topology]].
