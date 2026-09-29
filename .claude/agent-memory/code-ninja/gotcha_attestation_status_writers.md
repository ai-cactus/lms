---
name: gotcha-attestation-status-writers
description: a quiz PASS leaves status in_progress; attestCourse now gates on the pass (Q-27); no-quiz attest must await its progress write
metadata:
  type: project
---

Facts about the enrollment status that are easy to get wrong (found 2026-09-28, BUG-28/RISK-10; updated 2026-09-29 for Q-27):

- **A quiz pass does NOT set `completed`.** `/api/quiz/[id]/submit` writes `in_progress` (or `locked`) plus the score. "Passed" is only `score >= passingScore`. `completed` is a legacy status nothing writes. See also [[gotcha-enrollment-failed-status-unused]].
- **`attestCourse` enforces "finished before attest" (Q-27)**: a passed latest attempt at the served quiz, or progress 100 with no quiz. Details in [[project-attest-gate-and-read-access]].
- **The no-quiz attestation depends on its progress write landing first.** LearnClient `openNoQuizAttestation` AWAITS the progress POST (which records progress 100 / `lessons_complete`) before it opens the modal; without it the Q-27 gate refuses. Status moves from progress are guarded by `statusAfterProgress` (BUG-53), so a late progress ping no longer overwrites `attested`.

**How to apply:** do not add a "completed" branch expecting the quiz to write it. Any new attestation entry point must finish its progress write before it attests.
