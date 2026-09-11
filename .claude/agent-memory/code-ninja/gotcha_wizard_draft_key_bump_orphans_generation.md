---
name: gotcha_wizard_draft_key_bump_orphans_generation
description: Bumping the course-wizard sessionStorage draft key wipes half the resume handoff and orphans a paid Vertex run; migrate whenever readPendingGeneration() has jobs
metadata:
  type: project
---

Resuming an in-flight course generation needs BOTH halves of the handoff:
`pendingJobs` in localStorage (`lms_pending_generation`) carries the job ids, and
the sessionStorage draft (`lms_course_wizard_draft_v<n>`) carries the `formData`
and `stepKey` that put the wizard back on the generation step.

**Why:** bump the draft key and drop the old one, and the resumed wizard comes
back with `data.modules = []`. `useMultiJobStatus` then polls nothing, the
interstitial spins forever, and a generation the org has already paid Vertex for
is unrecoverable. The failure is silent — the jobs are fine server-side.

**How to apply:** any future draft-key bump must do what
`src/lib/course/wizard-draft-migration.ts` does for v3 → v4 — migrate the old
draft *only* when `readPendingGeneration()` returns jobs (a draft with no pending
run is still wiped), run the migration BEFORE the `SUPERSEDED_DRAFT_KEYS` wipe in
`CourseWizard`'s mount effect, and let an existing new-key draft win. Separately,
`PENDING_GENERATION_VERSION` must NOT be bumped alongside a payload change:
generations already in flight across the deploy boundary are discarded by
`readPendingGeneration` if it moves.

See [[course-wizard-9-step]].
