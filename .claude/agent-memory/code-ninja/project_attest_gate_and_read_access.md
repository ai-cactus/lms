---
name: project-attest-gate-and-read-access
description: Q-27 attest gate judges ONE quiz (the served one, latest submitted attempt); RISK-15 read access = isCourseOrganizationReviewer, never creator org
metadata:
  type: project
---

Q-27 (ruled 2026-09-29, branch bugfix/attest-gate-and-access): `attestCourse` refuses (by return) until the course is finished. With a quiz: the LATEST submitted attempt (timeTaken not null, by completedAt) at the quiz from `selectAssessmentQuiz` must meet THAT quiz's passingScore. Without one: progress >= 100.

**Why:** the player serves exactly one quiz (last lesson's, else the course's); production writers create at most one. Requiring every quiz (or the strictest bar across quizzes, as `resolvePassingScores` does for dashboards) could demand a quiz the learner is never shown and deadlock attestation. Latest-not-any mirrors the results screen's verdict.

**How to apply:** any new "which quiz" rule goes through `selectAssessmentQuiz` (src/lib/quiz/assessment.ts). Test fixtures for attestCourse need `progress: 100` + `course: { quiz: null, lessons: [] }` or a `quizAttempt.findFirst` mock.

RISK-15: course READ access (getCourseById, learn payload, 5 media routes, getVideoPlaybackUrl) keys on `Course.organizationId` via `isCourseOrganizationReviewer` (src/lib/course/read-access.ts). Still keyed on `creator.organizationId` at the time: the mapping page, the assign page and enrollUsers/assignCourseToRoles `isSameOrgCourse` — reported, not changed. See [[gotcha_authorship_is_not_ownership]].
