# Course creation flow redesign + role-target assignment

Date: 2026-09-11
Figma: `THERAPTLY` file `cySAabdYLDKzwbs88owBHn`, section `ADMINS` (`15733:195224`)

## Context

The course creation wizard was cut from 9 steps to 7 in `36ab8e2` (PR #562). That
refactor changed the ladder but not the screens. The design team has since vetted the
entire ADMINS section, and the wizard must now follow it end to end.

Separately, role-target assignment (a course that auto-enrols everyone holding a role)
is currently split across two surfaces: it is *created* in wizard step 7, and *listed
and revoked* from a card below the course list at `/dashboard/courses`. The design
folds both halves into one control — a chip-input role picker where the currently
targeted roles show as checked and unchecking revokes. The list/revoke card is removed.

Two items came out of the QA round as critical / launch-blocking, which is why these
two otherwise separate pieces of work ship together: they touch the same step 7.

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Step 2 accepts exactly one document.** Every course is therefore a single module. | Design is singular ("Drop your **file** here", "Supported formats: PDF, DOCX."). Retires the module builder. |
| D2 | **PHI stays a hard block.** A PHI-positive upload is rejected, the dropzone returns to empty, Next stays disabled. | Compliance posture unchanged. The vetted design agrees — `15733:273406` shows an empty dropzone with Next greyed. |
| D3 | **"Others (Custom)" is dropped from the role picker; "None" replaces it and is the default.** | Roles are a fixed `UserRole` enum. Custom categories are real; custom roles are not. |
| D4 | **`None` / `EVERYONE > Workers / Learners` / `EVERYONE > Managers` expand to concrete roles.** | No data-model change. `targetRoles` holds the expanded list, so `enrollUserForRoleTargets` and the nightly sweep keep working untouched. A role added to the enum later is *not* retroactively included. |
| D5 | **The role picker is one shared component mounted in three places** — wizard step 7, `/dashboard/training/courses/[id]/assign`, and the course details page. | The card at `/dashboard/courses` is deleted; revoke has to live somewhere reachable. |
| D6 | **Unchecking a role is a soft revoke, and the UI states the consequence.** Ticking down a role opens a confirm naming how many staff are already enrolled and that they keep the course. | Preserves today's `revokeRoleAssignment` semantics (clears `targetRoles`, leaves enrollments alone) while making the outcome explicit rather than buried in helper text. |
| D7 | **Build the whole design, fully functional** — including Regenerate Quiz and the course details page (`15733:277624`). | User direction. If the details page ships, its "View Course" must route to that specific course. |
| D9 | **Publishing-by-assignment records the assigner as reviewer.** Thread `session.user.organizationUserId` through `publishCourseOnAssignment` and write the attribution alongside the status flip. Lands in **PR-2**. | The person who assigns a draft is taking responsibility for it going live. Closes the third publish path (see Addendum). |
| D10 | **A null `approvedBy` on a published course falls back to "Created by: <name> (<role>)"** on the details-page hero — a different label, so it never implies a review that did not happen. | Every course published before D8 has no reviewer, so this state is permanent, not transitional. The Figma frame only shows the populated case. |
| D8 | **Persist the publish reviewer** by reusing the *dormant* `approvedByOrgUserId` / `approvedAt` columns that already exist on `Course` (`prisma/course.prisma:63-79`, relation `CourseApprover`, zero usage in `src/`). **No migration.** | `ConfirmPublishModal`'s "Reviewed by" input is `readOnly` and always the session user, so the reviewer is definitionally whoever clicked Publish — a session-derived FK captures exactly that, and gives the role for free so the hero can render "(Admin)" truthfully. Adding a second `reviewedBy` column would create two overlapping "who approved this" concepts on one model. |

## The designed flow

Shared chrome on every wizard step: top bar (Theraptly mark | `Step N of 7` | `Exit`),
a full-bleed progress bar directly beneath, a centred content column, and a `Back` /
`Next` row pinned at the bottom. Transient results (PHI scan, quality warnings) render
as a dismissible toast card overlapping the top bar — not inline.

### Step 1 — Category `15733:195626` `15733:195657` `15733:195729` `15733:195836`
Centred heading "What category best fits the course you're creating?". A single
required, **searchable** combobox (typeahead — `15733:195836` shows a partial query with
a caret). Options end with "Others (Custom)", which reveals the free-text custom name.

### Step 2 — Upload Training Documents `15733:195867` `15733:273406` `15733:195947`
One dropzone, **one file**, PDF/DOCX. On success: a file row (type icon, name, size,
"Upload completed!", trash) and a green SUCCESS toast; Next enabled. On PHI detection:
an amber WARNING toast, the dropzone stays/returns empty, Next disabled (D2).

### Step 3 — Course Details `15733:196030`
Two-column rows (label left, control right): Course Title, Short Description (textarea),
Category (read-only, filled), Content Type (select), No of Notes / Slides (select),
Deadline to Complete Course (stepper, "30 days"). Then a "Learning Objectives" block —
numbered objective inputs plus "+ Add objective".

### Step 4 — Course Quiz `15733:273840`
Two-column: Quiz Title, Number of Questions (stepper), Difficulty, Question Type,
Estimated Duration, Pass Mark, Attempts.

**Generation interstitial** `15733:196150` — still labelled `Step 4 of 7`, no Back/Next.
Heading "Your course is being created…", a four-item checklist (Analyzing policy and
procedure / Extract course input data / Create course content and quiz / Finalize all
modules) with tick and spinner states, and a "Goto Dashboard" escape. Leaving and
returning must not start a second generation. Completion raises a dashboard toast,
"Training resources for the course "…" is ready." `15733:274173`.

### Step 5 — Review Course Content
Two views over the same lesson set, toggled by a single button.
- **Notes** `15733:276315` `15733:276632` — article column (category badge, title,
  description, "Last update · N min read", headings, prose, numbered list, tip callout)
  with a Previous Lesson / Next Lesson pager; right rail carries `Edit ✎`,
  `View as Slides`, and a "Table of Content" card whose current entry is highlighted.
- **Slides** `15769:87037` `15733:276525` — title block with `Edit ✎` / `View as Notes`
  top-right, a large slide canvas with ← → arrows, and a numbered thumbnail rail.

### Step 6 — Review Quiz Questions `15733:276817`
A single card: "Editable quiz questions" + "N questions", a **Regenerate Quiz** button
top-right, one collapsible group headed by the quiz title, then question rows (number,
text, four options, per-question `Edit`). Footer row: "Add new question" + ⊕.
There are no sections — the earlier "Section Title" grouping was cut.

### Step 7 — Assigning & Publish
"Assign to" segmented control: `Individual Email Invite` | `Select by Roles`.
- Email `15733:277351` — "Add people, emails or names".
- Roles `15733:276938` `15733:277179` `15733:277053` — a **chip-input combobox**:
  selected roles as removable chips, "Add another role…" placeholder, chevron. The
  dropdown is a checkbox list: `None`, then `EVERYONE` (Workers / Learners, Managers),
  then `MANAGERS`, then `WORKERS / LEARNERS`.
- Below, unchanged in substance: Set Completion Deadline toggle + Due date / Due time;
  Automated reminders (value + unit + "before" + remove) with "Add reminder";
  Recurring Course Requirement toggle + interval select.
- **Confirm Course Review** modal `15734:289061` — illustration, course name, "Reviewed
  by" input, attestation checkbox, Cancel / Publish. Largely already built as
  `ConfirmPublishModal.tsx`.
- **Quality-warning toast** `15738:289815` — "This course has quality warnings and
  requires review before it can be assigned." with View / Dismiss. This is the existing
  F-051 review gate.
- **Course Published** modal `15734:289430` — "Assign to Workers" (primary) and
  "Go to Dashboard".

### Course details page `15733:277624`
Outside the wizard. Breadcrumb `Training Center / Create Course / Course details`, dark
hero (title, subtitle, "Approved by: <name> (<role>)", Active badge, read time, pass
mark, "View Course"), then Course Overview / What You'll Learn beside a Table of Content
rail carrying Skill Level, Duration, Last Updated. "View Course" must deep-link to that
course (D7). A course details page already exists — commit `b88331f` touched its back
link — so this is a rework, not a greenfield page.

## Code impact

- `src/components/dashboard/courses/wizardSteps.ts` — ladder keys stay; `modules`
  becomes `upload`. The generation interstitial must report `Step 4 of 7`, so the
  displayed number stops being `currentStepIndex + 1` for the `generate` step.
- `steps/Step2Modules.tsx` (457 lines) — replaced by a single-file upload step.
  `Step2ModulesHandle` / `commitDraft` and the draft-status gate in `CourseWizard`
  disappear with it.
- `steps/Step4Details.tsx`, `Step5Quiz.tsx`, `Step8QuizReview.tsx`,
  `Step9AssignPublish.tsx` — restyled to the two-column / card layouts. **Rename to
  match their real positions** (3, 4, 6, 7); they still carry 9-step names.
- `GenerationController.tsx` (~900 lines) — splits: the interstitial stays on step 4,
  the review becomes step 5 with the TOC rail, lesson pager and slides thumbnail rail.
- New shared `RoleTargetPicker` (D5) replacing the popover in `Step9AssignPublish.tsx`
  and the single-role `Select` in `AssignPublishClient.tsx`. Builds on the existing
  `groupRolesForSelect()` (`src/lib/rbac/role-utils.ts:215`), which already emits the
  design's two group headings.
- `RoleAssignmentsCard.tsx` and its render in
  `src/app/dashboard/(main)/courses/page.tsx:82-87` — deleted. `listRoleAssignments`
  survives, re-pointed at the picker's preload.
- `revokeRoleAssignment` keeps its soft semantics; the picker needs enrolled-count data
  for the confirm (D6) — `getRoleHolderCounts()` is the nearest existing helper.
- New: regenerate-whole-quiz action alongside `generateSingleQuestion`
  (`src/app/actions/quiz-ai.ts`).
- `prisma/course.prisma` — **no change**. D8 reuses the existing dormant `approvedByOrgUserId` / `approvedAt`; no migration is required.
- Draft key bumps to `_v4`: `formData.modules[]` changes shape, so a restored `_v3`
  draft would be malformed.

## Dead once D1 lands

`distributeQuestionCount` and `mergeModuleArtifacts` (`src/lib/course/`), the per-module
fan-out in `startModuleGenerationJobs`, `CourseModule.completionDeadlineDays` (written
today, read nowhere), and `isWholeCourse()` (becomes unconditionally true). Existing
multi-module courses must keep rendering — this restricts creation, not history.

## Assumptions (flagged, not asked)

1. The dropdown's role list in Figma is illustrative. Render all 13 assignable roles
   with their real display names; "Finance" appearing under both groups is a design
   slip — it is a manager role.
2. Content Type stays effectively single-valued (`notes_slides`,
   `Step4Details.tsx:30`), styled as the designed select.
3. Estimated Duration stays derived from question count (today read-only,
   `Step5Quiz.tsx:124`), styled to match the design's control.
4. `owner` remains excluded as a course target.

## Verification

- Unit: wizard ladder + step-number mapping, single-file upload gating, PHI block,
  role expansion (D4), soft-revoke confirm (D6), regenerate quiz, reviewer persistence.
- E2E (`tests/e2e/`): full 7-step creation through publish; PHI rejection; role target
  then revoke. **There is currently no e2e spec covering role assignment or revoke at
  all** — that gap closes here.
- `npm run verify:full` before push; `npm run e2e:local` for the wizard specs.
- qa-mafia re-validation of the course-creation story afterwards.

## Addendum — found during PR-1 (2026-09-11)

**There is a third publish path, and it records no reviewer.**
`publishCourseOnAssignment` (`src/lib/course/publish-on-assign.ts:32`) flips a draft to
`published` as a side effect of assigning it to staff. It is called twice, both from
`src/app/actions/enrollment.ts` (L337, L737), and receives only an `actorUserId` — a
`User` id, not an `OrganizationUser` id, so it cannot populate `approvedByOrgUserId` as
written.

It *does* bail out when `reviewRequired` is set, so a course the F-051 quality gate is
holding can never slip through unattributed. The exposure is limited to clean drafts
published by assignment.

Two consequences:
1. **PR-4 must tolerate a null `approvedBy` on a published course.** This is a live,
   reachable state, not merely a pre-D8 backlog. A hero that assumes presence renders
   "Approved by: undefined ()". Decide the fallback copy explicitly — omit the line, or
   fall back to the creator. **Resolved: D10 — fall back to the creator, relabelled.**
2. **PR-2 is the natural place to close it if we choose to.** Both call sites are in
   `enrollment.ts`, which PR-2 already reworks, and `session.user.organizationUserId` is
   in scope at both. **Resolved: D9 — record the assigner.**
