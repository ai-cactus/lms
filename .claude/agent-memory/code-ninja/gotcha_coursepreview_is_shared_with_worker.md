---
name: gotcha-coursepreview-is-shared-with-worker
description: CoursePreview renders BOTH the admin /preview route and the worker /worker/courses/[id] route — any hero edit hits the worker journey that worker-trainings-preview-flow.spec.ts pins
metadata:
  type: project
---

`src/components/dashboard/training/CoursePreview.tsx` has two callers, and only
one of them is obvious from the route you are editing:

- `src/app/dashboard/(main)/training/courses/[id]/preview/page.tsx` (admin)
- `src/app/worker/courses/[id]/page.tsx` — `mode="worker"`, and the ONLY course
  page a worker ever sees

**Why it bites:** the worker route is the middle hop of the journey
`tests/e2e/worker-trainings-preview-flow.spec.ts` pins
(`/worker/trainings` → `/worker/courses/[id]` → `/learn/[id]`), driven by the
hero's own "Start Course" / "Continue Course" button. Restyling the hero for an
admin Figma frame silently rewrites that button's surroundings. The admin branch
renders "View Course" instead, so an assertion written against one mode proves
nothing about the other.

Two mode-specific details worth knowing before you touch it:

- The back/breadcrumb link resolves to `/worker/courses/${course.id}` in worker
  mode — i.e. **the page itself**. Pre-existing, left alone during the
  2026-09-17 detail/preview split rather than "fixed", because changing worker
  navigation was outside that brief.
- The worker page passes `enrollments: []` deliberately (it sanitises other
  learners' rows out), so anything the hero derives from the roster is empty
  there.

**How to apply:** when editing CoursePreview, write the unit test in both modes
(`CoursePreview.hero.test.tsx` does), and run
`worker-trainings-preview-flow.spec.ts` alongside whatever admin spec you were
aiming at. See [[gotcha_e2e_specs_raw_sql_insert_courses]].
