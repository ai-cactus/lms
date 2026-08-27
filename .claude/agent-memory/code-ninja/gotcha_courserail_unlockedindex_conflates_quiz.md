---
name: gotcha-courserail-unlockedindex-conflates-quiz
description: CourseRail's single `unlockedIndex` prop locks BOTH lessons and the quiz; module navigation is free but quiz access must stay earned via highestUnlockedIndex
metadata:
  type: project
---

Learners may jump to ANY module freely (2026-08-27, `feature/free-module-navigation`,
QA finding #3), but `highestUnlockedIndex` must never advance as a side effect of
navigation — only `handleNext` (and the article's explicit "Proceed to Quiz" button)
may move it.

**Why:** `highestUnlockedIndex >= course.lessons.length - 1` is the quiz entry gate in
`src/app/learn/[id]/LearnClient.tsx`. If jumping to the last module advanced it, a
learner could click the last ToC entry and instantly unlock the quiz, defeating the
"Complete All Modules First" requirement — a compliance hole in a compliance-training
product, not just a UX slip.

**How to apply:** `CourseRail`'s single `unlockedIndex` prop gates lessons
(`i > unlockedIndex`) AND the quiz tile (`lessons.length > unlockedIndex`). So
`railUnlockedIndex` must be `lessons.length - 1` for an ungated learner — never `9999`
or `lessons.length`, both of which silently open the quiz. Keep the ToC's
`onSelectModule` delegating to `handleRailSelect` so the two navigation surfaces cannot
drift apart again.

Related: [[gotcha-enrollment-failed-status-unused]]
