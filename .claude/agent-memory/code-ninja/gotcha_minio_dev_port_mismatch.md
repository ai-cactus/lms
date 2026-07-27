---
name: gotcha-minio-dev-port-mismatch
description: docker-compose.dev.yml publishes MinIO on host 9005/9006 but .env sets MINIO_PORT=9000, so compose-started MinIO is unreachable from `next dev`
metadata:
  type: project
---

`docker-compose.dev.yml`'s `minio` service maps `9005:9000` (API) and `9006:9001`
(console), but `.env` has `MINIO_ENDPOINT=localhost` + `MINIO_PORT=9000`. A
`next dev` process on the host therefore gets `ECONNREFUSED :9000` even when the
compose MinIO container is Up — the inline comment next to the port mapping
("→ MINIO_PORT=9000") is misleading.

**Why:** the compose ports were shifted to avoid clashing with something else on
9000/9001, but `.env` was never updated to match. Anything storage-backed
(document upload, video playback via the `/api/video/[lessonId]` proxy, course
artifacts) silently fails locally as a result.

**How to apply:** when local storage flows must actually work, start MinIO
standalone on the ports `.env` expects rather than via compose:

```
docker run -d --name lms-dev-minio --restart unless-stopped --network lms-dev-net \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=lms_minio_dev -e MINIO_ROOT_PASSWORD=lms_minio_secret_dev \
  -v lms-dev-minio-data:/data minio/minio:latest server /data --console-address ":9001"
```

The bucket (`MINIO_BUCKET`, default `lms-documents`) is created lazily by
`MinIOProvider`, but a script writing objects directly must `makeBucket` itself.
Storage URIs are opaque and backend-prefixed: `minio://<bucket>/<key>` /
`gcs://<bucket>/<key>`; video objects live under the `system/videos/` prefix
(the video sweep worker reconciles exactly that prefix).

Related: [[project_local_ui_verification]].
