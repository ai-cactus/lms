---
name: resumable-upload-tests
description: Patterns and gotchas for testing the direct-to-GCS resumable upload feature (upload-url route, storage facade createUploadUrl, browser upload state machine)
metadata:
  type: project
---

Three test files added for the direct-to-GCS resumable upload change (fix/uploads branch, merged 2026-06-27):

- `src/lib/upload/resumable-upload.test.ts` — 19 unit tests for the browser-side state machine (fetch mocked via `vi.stubGlobal`)
- `src/app/api/system/video-courses/upload-url/route.test.ts` — 18 unit tests for the POST upload-url API route
- `src/lib/storage/index.upload-url.test.ts` — 8 unit tests for the `createUploadUrl` facade (GCS/MinIO singleton pattern)

**Key gotchas discovered:**

1. `*/` inside a block comment (`/* ... */`) in TypeScript closes the comment prematurely — the oxc parser used by vite rejects it. Avoid writing `bytes */total` in JSDoc. Use a workaround like "bytes-star/total".

2. When testing retry/backoff with `vi.useFakeTimers()` and a test expects the promise to REJECT, attach the rejection handler BEFORE `vi.runAllTimersAsync()` to prevent vitest's unhandled-rejection detection from firing:
   ```typescript
   const promise = resumableUpload({...});
   const assertion = expect(promise).rejects.toThrow(); // attach first
   await vi.runAllTimersAsync();
   await assertion;
   ```
   For resolve cases, `await vi.runAllTimersAsync(); await expect(promise).resolves...` is fine.

3. The `createUploadUrl` facade follows the same singleton-reset pattern as `listFiles` — use `vi.resetModules()` in `beforeEach` and dynamic imports inside each test body. Added as a separate file (`index.upload-url.test.ts`) rather than extending `index.test.ts` to avoid touching existing mock setup.

4. E2E for the video upload flow is NOT written because (a) the `/system/video-courses` area requires a custom HMAC-signed `system_admin_auth` cookie that Playwright can't forge without a test-token helper, and (b) intercepting the multi-step GCS resumable protocol (POST session + PUT chunks) in Playwright is impractical without a real or fully-stubbed GCS endpoint. The unit tests for `resumableUpload` give comprehensive coverage of the state machine.

**Why:** These three layers (state machine, route, facade) are the highest-risk additions in this PR.
**How to apply:** When future changes touch `resumable-upload.ts`, `upload-url/route.ts`, or `storage/index.ts createUploadUrl`, update these test files first.
