---
name: gotcha-attestation-status-writers
description: attestCourse checks no quiz pass; a quiz PASS leaves status in_progress; the progress route can overwrite `attested`
metadata:
  type: project
---

Three facts about the enrollment status that are easy to get wrong (found 2026-09-28, BUG-28/RISK-10):

- **A quiz pass does NOT set `completed`.** `/api/quiz/[id]/submit` writes `in_progress` (or `locked`) plus the score. "Passed" is only `score >= passingScore`. `completed` is a legacy status nothing writes. See also [[gotcha-enrollment-failed-status-unused]].
- **`attestCourse` checks ownership, archive and (since RISK-10) already-attested — nothing else.** It does not check that the quiz was passed or the lessons finished. The UI gate (`attestEligible && passed`) is the only thing keeping an owner from attesting an in-progress course by calling the action directly. Reported, not fixed: needs a product ruling.
- **`/api/enrollments/[id]/progress` rewrites status from a pre-read.** If it reads before an attestation and writes after, it overwrites `attested` with `lessons_complete`. For this reason the no-quiz attestation entry point (LearnClient `openNoQuizAttestation`) AWAITS the progress POST before it opens the modal.

**How to apply:** do not add a "completed" branch expecting the quiz to write it. Any new attestation entry point must finish its progress write before it attests. Any server-side eligibility change to `attestCourse` must take into account that passing is score-based.
