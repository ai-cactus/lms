---
name: gotcha-minio-dev-port-mismatch
description: docker-compose.dev.yml publishes MinIO on host 9005/9006 (not 9000/9001); an OLD .env copied before TOOL-12 still says MINIO_PORT=9000
metadata:
  type: project
---

`docker-compose.dev.yml`'s `minio` service maps `9005:9000` (API) and
`9006:9001` (console). `.env.example` says `MINIO_PORT=9005` since TOOL-12; a
local `.env` copied from an older example still has `9000` and gets
`ECONNREFUSED :9000` from `next dev` while the compose container is Up.

**Why:** the compose ports were shifted to avoid clashing with something else on
9000/9001. Anything storage-backed (document upload, video playback via the
`/api/video/[lessonId]` proxy, course artifacts) silently fails locally when the
port is wrong.

**How to apply:** if local storage flows fail, check `MINIO_PORT` first — with
compose MinIO it must be `9005`. Don't start a standalone `minio/minio` container
as a workaround: that image was withdrawn from Docker Hub (compose uses a GHCR
mirror).

The bucket (`MINIO_BUCKET`, default `lms-documents`) is created lazily by
`MinIOProvider`, but a script writing objects directly must `makeBucket` itself.
Storage URIs are opaque and backend-prefixed: `minio://<bucket>/<key>` /
`gcs://<bucket>/<key>`; video objects live under the `system/videos/` prefix
(the video sweep worker reconciles exactly that prefix).

Related: [[project_local_ui_verification]].
