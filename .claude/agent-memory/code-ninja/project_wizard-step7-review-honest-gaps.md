---
name: wizard-step7-review-honest-gaps
description: Step-7 "Review Course Content" ships three deliberate gaps vs the Figma mock (citation chips, Tip! copy, Edit button) — don't "fix" them by inventing data
metadata:
  type: project
---

The step-7 review screen (`src/components/dashboard/courses/review/`) deliberately
diverges from the Figma frames in three places. All three were agreed as the
honest version of a mock that shows data the product does not have.

- **No inline citation chips.** lms117 shows numbered citation anchors in the
  article body linked to highlighted passages in the Sources panel. The v4.6
  pipeline produces no citation anchors, so the Sources card shows only the
  module's source file chip plus the raw source excerpt.
- **Sources excerpt is same-session only.** `GeneratedCourseV46.sourceText`
  arrives per module but is merged into one string on `GeneratedCourse`, so a
  resumed draft cannot split it back per module and shows the file chip alone.
- **"Tip!" callout is labelled "Key Points".** The box renders the section's
  `keyPoints`, which are key points, not tips.
- **"Edit ✎" is rendered disabled.** There is no in-wizard content editor;
  lesson editing is a post-publish path. The button exists for design parity
  only — do not build an editor behind it without a plan.

**Why:** the alignment pass explicitly asked for the honest version rather than
fabricated citation anchors or invented editing.

**How to apply:** if a QA pass or design review flags any of these as a bug,
treat it as a known, intentional gap and confirm with the user before building
the missing data path. See [[project_course-wizard-9-step]].
