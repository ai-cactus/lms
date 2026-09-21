---
name: learn-admin-edit-affordance-e2e
description: Quill e2e typing must use fill(), not press/pressSequentially; worktree next build needs real npm ci, not a node_modules symlink
metadata:
  type: project
---

New spec `tests/e2e/learn-admin-edit-affordance.spec.ts` covers the
`canEditContent`/`mayEditCourseContent` gate (PR #649, `AdminLessonEditor`'s
"Edit Article" control) with 3 cases: HR own-org (positive control, edits and
reloads), Supervisor same course (course.read but not course.edit — absence
asserted with the permission cited in a comment per the
`rbac-role-change.spec.ts` absence-freezing lesson), and a second org's Owner
on a published global-catalogue course they don't own (read via
`isGlobalCatalog`, edit refused on the organisation-ownership half). All 3
pass under both `test:e2e` (dev server) and `e2e:local` (CI-parity prod
build).

Two non-obvious things this surfaced:

1. **Typing into a Quill editor (`.ql-editor`, `react-quill-new`) via
   `press`/`pressSequentially` is NOT reliable — it silently truncates to the
   FIRST character typed and the truncated value actually PERSISTS to the DB**
   (it is not a client-render illusion; a reload still shows just "H" for
   "HR-edited content..."). Root cause: the editor is a React-controlled
   component (`value={content}` + `onChange={setContent}`), and its
   re-render-per-keystroke races synthetic per-key input events even with a
   30ms `pressSequentially` delay. Fix: use `locator.fill(text)` on
   `.ql-editor` instead — Playwright's `fill()` is supported on
   `[contenteditable]` and sets the whole value in one action, sidestepping
   the race entirely. `Control+A` + `Delete` + `pressSequentially` is the
   wrong pattern for any Quill/ReactQuill field in this codebase; go straight
   to `fill()`.

2. **`next build` (Turbopack) refuses a `node_modules` symlink that points
   outside the directory it computes as the workspace root** — fails with
   "Symlink [project]/node_modules is invalid, it points out of the
   filesystem root". A fresh git worktree has its own `package-lock.json`
   (tracked in git), which Turbopack treats as the workspace-root marker, so
   it never walks up to the parent checkout's `node_modules` the way Node's
   own `require`/`npx` resolution does. The existing
   `gotcha_worktree_needs_node_modules_and_generated` memory (recorded against
   `vitest`) recommends symlinking `node_modules` — that still works for
   `tsc`/`eslint`/`vitest`/`prisma`, but **`npm run e2e:local` / any real
   `next build` in a worktree needs a REAL `npm ci` in that worktree**, not
   the symlink. `npx prisma generate` after `npm ci` is required too (the
   client generator binary resolves from the local install).

See [[project-test-framework]] for the general e2e/DB-seeding conventions and
[[full-e2e-suite-serial-flakiness]] for other worktree/environment traps.
