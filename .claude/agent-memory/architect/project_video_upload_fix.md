---
name: project-video-upload-fix
description: Direct-to-GCS resumable upload fix for video courses — approved plan in progress
metadata:
  type: project
---

Fix for HTTP 524 (Cloudflare timeout) on video uploads at /system/video-courses.

**Root cause confirmed:** `upload/route.ts` buffers entire file in memory then uploads to GCS, all within one HTTP request that Cloudflare kills at ~100s.

**Chosen solution:** Direct-to-GCS resumable upload via V4 signed URL (browser uploads directly to storage.googleapis.com, bypassing Cloudflare/Nginx/Next.js).

**Why:** Signed URL minting returns in <1s (no timeout); actual bytes flow browser→GCS bypassing Cloudflare entirely; GCS resumable protocol allows resume after interruption.

**How to apply:** Plan approved 2026-06-27. Code-ninja to implement across storage layer, new upload-url API route, resumable-upload client helper, and VideoCourseForm.

**Key design decisions:**
- New route: POST /api/system/video-courses/upload-url (mints signed URL, returns in <1s)
- Old route /upload kept as fallback (client falls back when GCS unavailable)
- StorageProvider interface gets new `createUploadUrl` method
- Client helper: src/lib/upload/resumable-upload.ts (pure, no React)
- Orphan cleanup: existing sweeper is the backstop; no server-side abort cleanup needed (server not in bytes path)
- CORS must be applied to GCS bucket before testing
- Chunk size: 8 MiB (required GCS minimum recommendation, multiple of 256 KiB)

**GCS CORS cors.json location:** Must be applied via `gcloud storage buckets update gs://BUCKET --cors-file=cors.json`
