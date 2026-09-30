---
name: video-playback-first-real-run-fixes
description: tests/e2e/video-playback.spec.ts's first live run (TOOL-21 committed the fixture) surfaced 3 pre-existing test bugs, not product bugs — root-cause technique and fixes
metadata:
  type: project
---

`tests/e2e/video-playback.spec.ts` existed for a while but self-skipped (missing
`tests/e2e/fixtures/sample-lesson.mp4`) until TOOL-21 committed the binary
(branch `chore/tooling-tests-batch`, 2026-09-28). Its first real run against
MinIO failed 3 of 8 tests. All three were test-authoring bugs, proven via
Playwright trace.zip network/console inspection (`unzip trace.zip`, then read
`0-trace.network`/`0-trace.trace` as newline-delimited JSON) — NOT product
defects in `src/lib/video/gating.ts` or the `/api/video/[lessonId]` proxy.

**Why:** three findings, each confirmed with live evidence before touching the
test:
1. **Poster requests counted as "video bytes".** The mobile "inactive lesson
   stays preload=none" test matched `/\/api\/video\/([^/?]+)/` against request
   URLs — this matches BOTH `/api/video/[id]` (bytes) and `/api/video/[id]/poster`
   (always fetched, even at `preload="none"`, per `VideoPlayer.tsx`'s own
   comment). Fix: anchor the regex to end after the id (`(?:\?|$)`).
2. **Duplicate-text strict-mode violation.** "Watch the video to unlock the
   quiz" legitimately renders TWICE at once in `LearnClient.tsx` — a per-lesson
   hint under the active player AND the bottom nav's `proceedHint`. Not a bug;
   scope with `.first()`.
3. **Seek assumed a new Range request.** Traced proof: the browser's *first*
   request is `Range: bytes=0-` and the proxy correctly answers with the WHOLE
   54 KB fixture in one 206 (`Content-Range: bytes 0-54326/54327`). With every
   byte already client-buffered, NO seek (forward or backward) can ever provoke
   a second request against this fixture — this is an artifact of the fixture
   being smaller than any real chunking threshold, not a Range-support gap (a
   sibling test already proves 206 support). Fix: assert the behavior that
   matters instead — `currentTime` moves and playback resumes.
4. **(Found while fixing #2, initially looked like a real bug.)** After fixing
   #2, "playing through unlocks Proceed to Quiz" still failed: DIAG instrumentation
   proved the video genuinely reached `ended:true`, `currentTime === duration`,
   yet the button stayed disabled. Root cause: `courseFixture` seeds a
   **two-lesson** course (shared with the mobile test, which needs 2 lessons).
   `isProceedBlocked` in `LearnClient.tsx` is `isVideoGateBlocked ||
   !hasCompletedAllModules`, and `hasCompletedAllModules` requires
   `highestUnlockedIndex` to reach the LAST lesson index — watching only
   lesson A's video clears lesson A's own gate but never the whole-course one.
   Fix: the test now clicks "Next" and plays lesson B through too, matching the
   real multi-lesson completion model (`handleNext` advances
   `highestUnlockedIndex` unconditionally between non-last lessons; only the
   LAST lesson's `handleNext` branch checks `isVideoQuizGateBlocked()`).

**How to apply:** when a long-dormant/self-skipping e2e spec runs for the
first time, don't assume a red result is a product regression — pull the
`trace.zip` (`0-trace.network` = HAR-like JSON lines, `0-trace.trace` has
console messages) and check what ACTUALLY happened before touching product
code. All 3 root causes here were provable from the trace alone. See
[qa-wave1-regression-patterns](qa-wave1-regression-patterns.md) for the
general "verify before fixing" discipline, and
[tier3-dynamic-import-tests](tier3-dynamic-import-tests.md) for another case
where a live rehearsal (not static reading) was what settled the question.
Commit: `8dfd15e9` on `chore/tooling-tests-batch`.
