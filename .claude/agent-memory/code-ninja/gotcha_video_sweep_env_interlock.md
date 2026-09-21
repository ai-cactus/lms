---
name: gotcha-video-sweep-env-interlock
description: Guardrails that live in the env file can't stop a copied env file — the video sweeper's destructive gates key on APP_URL, the one value a copy must change.
metadata:
  type: project
---

The orphan video sweeper deleted production GCS videos twice (2026-07-16, 2026-07-21). An 08-08 finding that `.env.staging` carried the production `GCP_BUCKET_NAME` + `GCS_KEY_BASE64` was the suspected root cause. **Resolved for storage:** staging logs on 2026-08-28 proved `GCP_BUCKET_NAME` is unset on staging, so staging uses MinIO, not the production bucket. The interlock below stays as a guard regardless. Whether staging's `GOOGLE_PROJECT_ID` points Vertex at the production project is still unverified — tracked as **RISK-07** in `docs/local/OPEN-ISSUES.md`.

**Why the earlier guardrails weren't enough:** the opt-in flag, empty-reference-set abort, delete cap and single-backend listing all live in the same `.env` file that gets copied between environments — a copy brings the arming flags along with the bucket and credentials. `src/lib/queue/video-sweep-worker.ts` therefore also requires `VIDEO_SWEEP_OWNER_APP_URL` to **exactly equal** `APP_URL`, and `VIDEO_SWEEP_DRY_RUN` defaults to dry-run unless it is exactly `'false'`. `APP_URL` is the interlock key precisely because a copied env file *must* change it or auth redirects and emailed links break loudly.

**How to apply:** Any future destructive background job (mass delete, bulk email, data purge) gets the same treatment — an enable flag alone is not a safety mechanism when env files are copied, and the fail-safe default for anything destructive is the harmless one. The ops-layer principle still holds: **the owning environment should be the only one holding write credentials for a bucket.** Code-level interlocks are a backstop, not a substitute. See [[deploy-topology]].
