---
name: gotcha-self-service-verbs-pollute-the-matrix
description: `assessment.create` / `enrollment.edit` are self-service (submit MY OWN attempt), so read-only admin roles legitimately hold them — a matrix "R" cell reads as "CR" in the registry.
metadata:
  type: project
---

`selfServicePermissions` in `src/lib/rbac/permissions.ts` (`enrollment.edit`,
`assessment.create`, `notification.*`) is mixed into every role that has to be able
to **take training itself**, supervisor included. So a founder-matrix cell that says
`R` can correctly read as `CR` in the registry, and a dump of `can(role, verb)` will
look like an over-grant when it is not.

**Why:** the registry is four verbs per resource, so "submit my own quiz attempt" and
"author a quiz" are the same string. Removing the verb to make a matrix cell match
would break Learn Mode for that role.

**How to apply:**
- Before "fixing" an apparent over-grant on `assessment.create` / `enrollment.edit`,
  check whether the role reaches it through `selfServicePermissions`. If it does, the
  fix is a `diverges()` note in `matrix-conformance.test.ts`, never a removal.
- Quiz **authoring** is not gated on `assessment.*` at all — it is course content,
  gated on `course.edit` via `assertCanEditCourseContent` in `actions/lesson.ts`.
  There is no quiz-deletion path in the product, so `assessment.delete` had **zero**
  call sites when it was withdrawn from `clinicalDirector` (2026-09-16).
- Several registry verbs are declared and checked **nowhere** — grep before assuming a
  grant does anything. `certificate.create` was one until 2026-09-16, when the matrix's
  `R`→`CR` promotion gave it its first gate in `issueCertificate`; `certificate.edit`
  and `certificate.delete` still have none. A dead verb is also a *latent* verb: the
  day someone gates a path on it, every role already holding it walks through.
- `assessment.read` is the answer-sheet verb (`staff.ts` `getEnrollmentQuizResult`,
  `enrollment.ts`), conjoined with `isAdminRole` — **every worker role holds it** so it
  can read its own attempt, so the conjunction is load-bearing.

**A registry description is not a ruling.** #626 narrowed HR out of the answer sheet
citing the `hr` role's own `description` ("blocked from question-by-question assessment
scoring") — text *we* wrote. Asked to settle it, the founder reversed it ("HR can build
quizzes and view results", 2026-09-16). When a gate's justification cites a description
rather than a founder answer, treat it as a hypothesis, not authority — and when a
ruling lands, rewrite the argument instead of just flipping the boolean, or the next
reader re-narrows on the stale reasoning.

**Widening a verb moves UI rows too.** The HR grant flipped two `/dashboard/roles` rows
(`roles-matrix-config.ts`: "Author clinical assessments" = `assessment.edit`, "View
question-level scores" = `assessment.read`). `roles-matrix-config.test.ts` is the file
that catches it — check it on any grant change, and fix the test NAME as well, since
they read "…but cannot X".

**Unresolved cells:** for a directive cell we must not guess at, the conformance table
briefly carried an `open(directive, question)` constructor beside `cell()`/`diverges()`
that rendered as a vitest `todo`. Removed once answered (dead code), but it is the
pattern to reach for again — see commits acc84b1 → cabebd2.

See [[gotcha_rbac_actor_lists_vs_permissions]].
