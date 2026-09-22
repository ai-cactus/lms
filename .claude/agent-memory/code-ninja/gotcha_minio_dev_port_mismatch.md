---
name: gotcha-minio-dev-port-mismatch
description: docker-compose.dev.yml publishes MinIO on host 9005/9006, but .env.example still says MINIO_PORT=9000 — a fresh .env copied from it can't reach compose MinIO from `next dev`
metadata:
  type: project
---

`docker-compose.dev.yml`'s `minio` service (image
`quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z`) maps `9005:9000` (API) and
`9006:9001` (console). The inline comment next to the port mapping
("→ MINIO_PORT=9000") is misleading.

**Current state (2026-09-21):** the maintainer's local `.env` has been fixed to
`MINIO_PORT=9005`, but **`.env.example` still says `MINIO_PORT=9000`**. Any `.env`
freshly copied from the example gets `ECONNREFUSED :9000` from a `next dev`
process on the host even while the compose MinIO container is Up.

**Why:** the compose ports were shifted to avoid clashing with something else on
9000/9001, and the example env was never updated to match. Anything
storage-backed (document upload, video playback via the `/api/video/[lessonId]`
proxy, course artifacts) silently fails locally as a result.

**How to apply:** if local storage flows fail, check `MINIO_PORT` first — with
compose MinIO it must be `9005`. Don't start a standalone `minio/minio` container
as a workaround: that image was withdrawn from Docker Hub (the compose file uses
quay.io).

The bucket (`MINIO_BUCKET`, default `lms-documents`) is created lazily by
`MinIOProvider`, but a script writing objects directly must `makeBucket` itself.
Storage URIs are opaque and backend-prefixed: `minio://<bucket>/<key>` /
`gcs://<bucket>/<key>`; video objects live under the `system/videos/` prefix
(the video sweep worker reconciles exactly that prefix).

Related: [[project_local_ui_verification]].
