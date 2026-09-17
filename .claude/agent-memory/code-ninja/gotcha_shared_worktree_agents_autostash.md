---
name: gotcha-shared-worktree-agents-autostash
description: Concurrent agents share ONE working tree here — another agent's branch switch auto-stashes your uncommitted work and can mix its edits into your files; commit early and stage by hunk
metadata:
  type: project
---

Multiple agents run against the **same** `/home/dokimazo-tech/dev247/lms` working
tree. A sibling agent switching branches auto-stashes your uncommitted work and
leaves you on *its* branch — silently.

**Why:** the harness's branch-switch helper stashes a dirty tree rather than
refusing, labelling it e.g.
`stash@{0}: On <your-branch>: code-ninja: auto-stash before <their-branch> (was on <your-branch>)`.
Nothing warns you; you find out when `git status` is suddenly near-clean, greps
for your own edits return nothing, and `git branch --show-current` names a branch
you never created.

**How to apply:**

1. **Commit as soon as a coherent slice is green.** Every uncommitted minute is
   exposure. Do not batch a whole multi-file task into one end-of-run commit.
2. **Recovery:** `git stash list` — find the entry naming your branch. Then
   `git checkout <your-branch> && git stash pop stash@{N}`. Untracked new files
   are included (verify with `git stash show --include-untracked --stat`), so a
   brand-new test file is not lost.
3. **Assume shared files are contaminated.** A file you both touched will carry
   both sets of edits. Before committing, `git diff -- <file> | grep -n '^@@'`,
   identify which hunks are yours, then stage only those:
   `git diff -- <file> > all.patch`, cut your hunks into `mine.patch`, and
   `git apply --cached mine.patch` — that stages yours while leaving theirs in
   the working tree. Commit from the index (`git commit`, never `-a`).
4. **Do not "fix" red tests you did not cause.** A sibling's half-applied change
   (their test edits present, their source edits gone) shows up as failures in
   describe blocks you never touched. Confirm by reverting the test file to HEAD
   and re-running before you believe you broke something.
5. `git worktree add` into the scratchpad is blocked by the permission system, so
   isolated verification is not available — verify in place and filter with
   `vitest -t '<describe name>'` to prove only your own tests.

Related: [[build_typecheck_scope]], [[project_offline_migrations]].
