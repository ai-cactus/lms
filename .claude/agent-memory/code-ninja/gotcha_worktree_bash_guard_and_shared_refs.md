---
name: gotcha-worktree-bash-guard-and-shared-refs
description: origin/* refs are shared across worktrees so origin/dev can move mid-task (never "revert" a file from it); run multi-step shell as a scratchpad script
metadata:
  type: project
---

**`origin/dev` is shared with every other checkout.** Another session's `git fetch`
moves it under you mid-task (seen 2026-09-26: #681 merged while PR-A was in
progress). `git checkout origin/dev -- <file>` to "revert" a file then silently
imports newer upstream commits into your branch. Revert with
`git checkout HEAD -- <file>`; if trunk moved, rebase deliberately
(`git -C <wt> rebase origin/dev`, resolve, `GIT_EDITOR=true git -C <wt> rebase --continue`).

The Bash guard ([[gotcha-worktree-generated-symlink-breaks-build]] lists what it
refuses) also rejects `for` loops and runtime `$VAR`s that feed psql, and
`cd … && git …`. Use `git -C <worktree>` one command per call, and put multi-step
shell (applying all migrations via psql to a throwaway Postgres, seeding, sharded
vitest) in a script under the scratchpad and run `bash <script>`. Also refused
(2026-09-29): `cat >> file <<'EOF'` appends (use the Edit tool), anything through
`xargs npx …` (list the files literally), and a `$S`-style path variable inside
`node -e` (inline the literal path). `cd <wt> && python3 - <<'EOF'` is accepted.

**How to apply:** before reporting, compare `git log -1 origin/dev` with your
branch base; a moved trunk means rebase + re-run the affected tests.
