---
name: gotcha-coursearticle-hasfulllayout-gates-quiz
description: CourseArticle's hasFullLayout couples ToC + top bar + Prev/Next; dropping onSelectModule to hide chrome deadlocks the quiz gate because Prev/Next is the only writer of highestUnlockedIndex
metadata:
  type: project
---

Never hide article chrome by turning `hasFullLayout` off (i.e. by passing
`onSelectModule={undefined}` or `lessons={undefined}` to
`src/components/courses/CourseArticle.tsx`). It is a single flag guarding THREE
regions at once: the Table of Contents, the top bar, and the Previous/Next footer.

**Why:** that footer's `onNext` is the only surface that calls
`LearnClient.handleNext`, which is the only writer of `highestUnlockedIndex`. The
article's own "Proceed to Quiz" stays disabled until
`highestUnlockedIndex >= lessons.length - 1`, and a fresh enrollment seeds it at `0`.
Kill the footer and any course with 2+ lessons can never reach its quiz — a permanent
compliance lockout that no test of the heading markup would catch.

**How to apply:** when a design asks to remove something from the article, gate the
specific element in `LearnClient.tsx`'s own markup, not the props that feed
`hasFullLayout`. This is exactly how the whole-course rule was implemented
(2026-08-31, `feature/whole-course-module-headings`): `isWholeCourse(course.moduleCount)`
gates ONLY the `<h2>Module N</h2>` block, leaving `updateProgress`,
`highestUnlockedIndex`, `railUnlockedIndex`, `hasCompletedAllModules`, `handleNext`,
`handleRailSelect` and `isProceedBlocked` untouched. Guard any such change with a test
that pages to the last lesson and asserts "Proceed to Quiz" becomes enabled.

Related: [[gotcha-courserail-unlockedindex-conflates-quiz]]
