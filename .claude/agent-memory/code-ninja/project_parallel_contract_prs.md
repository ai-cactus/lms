---
name: project-parallel-contract-prs
description: How to finish and PROVE a PR that imports a Server Action another agent is still writing — stub it locally, typecheck, revert the stub
metadata:
  type: project
---

This repo splits a feature across PRs built **concurrently against a fixed
signature** (PR 3b, the slide editor, imported `updateLessonSlideContent` while
PR 3c was still writing it). The consumer branch then cannot typecheck: `tsc`
reports `TS2724 … has no exported member named X` and nothing else.

**Why it matters:** "typecheck fails" is indistinguishable from "my code is
broken" in a hand-off report, so the consumer PR looks unfinished when it is not.

**How to apply:** prove the rest of the branch is clean before handing back —

1. `npx tsc --noEmit` and confirm the ONLY errors are the missing export.
2. Append a stub matching the agreed signature to the action file, re-run
   `tsc --noEmit`, and confirm exit 0 (this also checks the call sites against
   the contract's real return type, not just its name).
3. `git checkout -- src/app/actions/course.ts` — never commit the stub. A
   stubbed Server Action that returns success is an authorisation hole if it
   escapes.
4. Report both results, and say the branch is red on that import until the
   producer PR merges. Merge order is the orchestrator's call, not yours.

Unit tests are unaffected either way: `vi.mock('@/app/actions/course', …)` with
a factory replaces the module at runtime, so the suite is green while `tsc` is
red. Do not read that green as the branch being complete.

Related: [[gotcha_shared_worktree_agents_autostash]].
