---
name: course-generation-banner-polling-tests
description: How the CoursesListClient pending-generation banner poll loop was finally covered (fix/course-generation-banner-truthfulness), the fake-timer technique used, and the shape trap in JobResponse
metadata:
  type: project
---

`CoursesListClient.tsx`'s `PendingGenerationBanner` polls `checkCourseGenerationJobV46` every 5s
off a `setInterval` inside a `useEffect`, driven by `readPendingGeneration()` /
`localStorage`. Before this fix the test file never seeded `localStorage`, so the whole
polling path (`generating`/`done`/`failed`/`unknown`) was silently untested — a real
staging bug (failed jobs, banner stuck saying "still being generated") shipped unnoticed.
10 new tests were added to the existing `CoursesListClient.test.tsx` (no new file — this
component's tests already live in one file) under a new
`describe('CoursesListClient — pending generation banner')` block.

**The shape trap (do not miss this again):** `JobResponse<T>` (`src/types/job.ts`) is
`{ status?, result?, error? }`. A genuinely failed job returns **both**
`{ status: 'failed', error: '...' }` (`course-ai-v4.6.ts:727` and `:739`, always paired).
A bare `{ error }` with **no** `status` (e.g. `'Job not found'`, or the catch-block's
`Failed to check job: ...`) is a *different*, undetermined signal that must NOT route to
`failed` — it only feeds a 3-consecutive-poll tolerance before the banner gives up as
`unknown`. A test that mocks a failure as bare `{ error }` and expects `failed` asserts the
OLD buggy behaviour (pre-fix code did `res.status === 'failed' || res.error`). Mock these
two shapes distinctly and never conflate them.

**Fake-timer technique for the async setInterval callback:** `vi.useFakeTimers()` +
`await act(async () => { await vi.advanceTimersByTimeAsync(5000); })` per tick — this repo's
only prior fake-timer test (`VideoPlayer.test.tsx`) used sync `vi.advanceTimersByTime` inside
`act()` for a sync timer; the course-generation interval callback is `async` (awaits
`Promise.all`), so the sync variant does not flush the promise — `advanceTimersByTimeAsync` is
required. `vi.useFakeTimers()` also fakes `Date`, so `writePendingGeneration`'s
`Date.now()` timestamp advances deterministically with the fake clock — no real-time
staleness flake risk.

**Always assert the polling path first.** Before any other assertion, assert the
`generating` banner text is present after seeding localStorage + render — a mis-shaped
localStorage payload (wrong version, missing `jobs`) is silently discarded by
`readPendingGeneration()` and the test would pass for the wrong reason (banner stuck
`hidden`, poll fn never called). See [[project-test-framework]] for the general Vitest
conventions this project follows.

Logger: `CoursesListClient.tsx` now imports `@/lib/logger` (the fix added `logger.warn`/
`logger.error` calls on poll failure) — mock it in this test file the same way
`VideoPlayer.test.tsx` does (`{ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }`
+ `maskEmail` passthrough) to keep output clean; ~11 other test files in the repo already
follow this pattern.

Result: 13 files / 138 tests green in `src/components/dashboard/courses` (was 13/127
pre-fix); `npm run typecheck` and `npm run lint` both clean (0 errors) after the addition.
