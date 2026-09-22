---
name: course-wizard-pr3b-restyle-test-patterns
description: PR-3b (course-wizard-restyle) — presentation-only Figma restyle test fixes; Playwright role="alert" collides with Next's route announcer; flattened-accordion rewrite pattern; stepper-button pinning
metadata:
  type: project
---

Context: PR-3b restyled all 7 course-wizard screens to the vetted Figma design
with NO behaviour/step-ladder/storage-key/server-action changes (all settled in
[course-wizard-single-doc-pr3a-test-patterns](course-wizard-single-doc-pr3a-test-patterns.md),
already merged). 8 unit/e2e tests broke — all confirmed UI-text churn, zero
product defects. Files touched: `Step2Upload.test.tsx`,
`tests/e2e/course-creation-phi-rejection.spec.ts`, `Step6QuizReview.test.tsx`
(7 tests rewritten), plus new `Step1Category.test.tsx` (7 tests, new combobox)
and stepper-pinning additions to `Step4Quiz.test.tsx` / `Step7Assign.test.tsx`.
285 unit tests green (up from 260 passing + 8 failing baseline).

**Playwright `getByRole('alert')` collides with Next's own route announcer —
jsdom does not have this problem.** Next renders a permanent, empty
`<div role="alert" aria-live="assertive" id="__next-route-announcer__">` on
every page. A live e2e assertion on `page.getByRole('alert')` hits strict-mode
"resolved to 2 elements" once the app also renders a real alert (e.g. the new
`WizardToast` PHI-warning toast) — this never shows up in Vitest/RTL because
jsdom doesn't render Next's runtime chrome.
**Why:** cost real debugging time here; the RTL unit test's identical
`screen.findByRole('alert')` worked with zero ambiguity.
**How to apply:** in Playwright specs, never bare `page.getByRole('alert')`.
Also don't reach for `{ name: /regex/i }` to disambiguate — ARIA's `alert`
role is NOT named-from-content (accname spec), so a name filter silently
matches nothing even though the text is right there in a `toBeVisible()`
snapshot. Use `.filter({ hasText: /.../ })` instead, which is a text filter,
not an accessible-name filter, and correctly narrows to the real alert.

**Rewriting tests for a "many-sections flattened into one" restyle: split
each old test into (a) what rendering changed and (b) what the underlying data
model/grouping still does.** `Step6QuizReview`'s per-module `<Accordion>`
items collapsed into a single continuously-numbered list, but
`groupQuestionsByModule` and its `tag`/`questionIndexes` fields are untouched
— the footer's one "Add new question" button still targets
`sections[sections.length - 1]`, so a manually added question still inherits
the *last* module's tag. Pattern used: keep `section.title`'s per-section
naming as explicitly-called-out DEAD CODE (never rendered any more — the
single header comes from an unrelated `quizGroupTitle =
data.quizTitle?.trim() || data.title?.trim() || 'Quiz Title'` computation
instead), but keep testing tag-inheritance and untagged-stays-untagged via the
one remaining control, since that protects legacy multi-module courses.
Getting the fixture right mattered: `WIZARD_FORM_DATA.quizTitle` is set, so
the single-section header is the QUIZ title, not the course title, in the
default fixture — the course-title fallback needs `{ quizTitle: '' }`
explicitly to actually exercise that branch.

**Scoping to "the card for question X" without a `within(section)` wrapper:**
`screen.getByText(questionText).closest('.bg-background-secondary')` works
because RTL's default `getByText` matcher only looks at an element's *direct*
text-node children (`getNodeText` joins `childNodes` filtered to
`TEXT_NODE`), so a `<div><span>3.</span>{questionText}</div>` matches on
`questionText` alone — the numbering span doesn't pollute the match. Reused
this to find the right "Edit" button in a flat, unscoped list.

**New `Step1Category.tsx` (shadcn `Command`+`Popover`, replacing plain
`Select`) needs `findBy*`, not `getBy*`, for the very first interaction** —
the component renders a "Loading categories…" placeholder synchronously
before the `getCategories()` promise resolves, same trap as `Step3Details`'s
existing category-echo test. cmdk's `CommandItem` renders `role="option"`
(confirmed by reading `node_modules/cmdk/dist/index.mjs` — not documented
inline), and `CommandInput` renders its own second `role="combobox"` (named by
its placeholder) once the popover is open, so scope trigger assertions with
`{ name: /Category/i }` when both are on screen.

**Stepper buttons (chevron up/down replacing bare `<input>`) preserve the
exact same `onChange(field, String(...))` write and clamping the old plain
number input enforced** — `Step4Quiz`'s question-count (1-25) / attempts
(1-10) and `Step7Assign`'s per-reminder stepper (min 0, no max, matching the
prior `min={0}` attribute with no ceiling). Pin with one
increment/decrement-writes-correctly test plus one at-boundary
does-not-step-past test per control; avoid rendering the same step multiple
times in one test to compare button click targets — `getAllByRole` across two
mounted instances is a trap (each mount gets its own `onChange` mock,
so a stray click can silently assert against the wrong instance's spy).

Confirmed e2e-DB-pollution-looks-like-a-regression again (see user memory
e2e-db-pollution-looks-like-a-regression):
`course.spec.ts`'s ENG-022 test failed with a Playwright strict-mode "2
elements" error on the worker's table row after running `prisma db seed`
against an already-8-hours-seeded `lms_e2e` DB — a stray non-seed-ID
enrollment row (random cuid, not the fixed `88888888-...` seed ID) for the
same worker+course, left by an earlier test run's own side effect. `prisma
migrate reset` is blocked by Prisma's own AI-safety gate (refuses without
literal user consent text) — don't try to work around it; instead find and
delete the specific stray row by ID after confirming zero FK dependents
(`quiz_attempts`/`certificates`/`reminder_logs`/`reminder_nudges` on
`enrollment_id`). Re-running the full spec trio after the targeted delete
went green, confirming it was pollution, not a PR-3b regression.
