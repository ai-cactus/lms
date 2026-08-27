---
name: free-module-navigation-tests
description: LearnClient/CourseRail free-navigation test patterns — CourseRail's restrictive unlockedIndex branch never actually renders in current app flow, jsdom rAF/scrollIntoView stubbing pattern
metadata:
  type: project
---

Branch `feature/free-module-navigation` (commit f2939fa) let learners jump to any
module from the Table of Contents without advancing `highestUnlockedIndex` — that
index is what gates real quiz access. Added `src/components/courses/CourseRail.test.tsx`
(first test file for that component, 7 tests) and extended
`src/app/learn/[id]/LearnClient.test.tsx` with a "Free module navigation" describe
block (4 tests). Baseline was 55 files/513 tests; final is 56/524 (+1 file, +11 tests).

**Non-obvious finding: `CourseRail`'s restrictive `unlockedIndex` branch is
currently unreachable via the real render tree.** `<CourseRail>` only mounts when
`showSharedLayout` is true (`isQuizIndex || (quizStep==='review' && quizResults)`),
and every code path that sets `activeIndex >= lessons.length` (handleNext,
handleConfirmQuiz, onProceedToQuiz, every `deriveSeed` branch) sets `quizUnlocked`
(or `quizResults`) to true in the SAME synchronous update. So by the time
`CourseRail` ever paints, `railUnlockedIndex` is already `course.lessons.length` —
the `Math.max(0, lessons.length - 1)` fallback branch never actually gets observed
via full-app rendering, pre-fix and post-fix alike (not something this diff
introduced). Given that, the meaningful regression guard for "railUnlockedIndex
must not leak `lessons.length`+ before it's earned" has to live at the *component*
level (`CourseRail.test.tsx`, direct props, no LearnClient needed) rather than as
an integration assertion through LearnClient — there is no reachable integration
scenario to assert against. The real compliance guard that IS integration-testable
is the `handleRailSelect` gate itself (see LearnClient's "Complete All Modules
First" vs "Ready for the Quiz?" modal distinction — pinned directly).

**jsdom stubbing pattern needed for any test that clicks a ToC/module-select
button in LearnClient**: `scrollToModule` calls `moduleRefs.current[index]
?.scrollIntoView(...)` inside `requestAnimationFrame`. jsdom does not implement
`scrollIntoView` at all (undefined on `Element.prototype`), so any click that
reaches `scrollToModule` throws `TypeError: ... is not a function` unless you
first assign a no-op (`Element.prototype.scrollIntoView = function() {};`) and
stub `requestAnimationFrame` to run its callback synchronously
(`vi.stubGlobal('requestAnimationFrame', cb => { cb(0); return 0; })`) so the
effect is observable without an extra `await`/`act` flush. Per-element
`vi.spyOn(el, 'scrollIntoView')` after the prototype no-op is in place is the
clean way to assert *which* module scrolled (grab real DOM nodes via
`container.querySelector('#module-N')`, spy each, assert only the target fired).

**Mid-task scope correction pattern**: the orchestrator pulled a planned
"pin current Proceed-to-Quiz always-enabled behavior" test mid-task because the
user decided to gate that button in a follow-up commit — a test pinning the
soon-to-be-reversed behavior would have been dead on arrival. Good reminder to
treat "document current behavior, don't endorse it" instructions as provisional
right up until submission, not just at task start.

**Revert-and-confirm still catches real regressions here**: temporarily
reintroduced the exact bug this branch fixes (made the lesson-select branch
advance `highestUnlockedIndex`/call `updateProgress`) — 2 of the 4 new tests
failed immediately and specifically (wrong modal shown; progress endpoint called
when it shouldn't be), confirming the tests pin the right property before
reverting via a pre-edit backup copy (`cp` to `/tmp`, not `git checkout`, since
the file was never staged/committed as a diff to discard).

See [Test Framework & Patterns](project-test-framework.md).
