---
name: gotcha-shared-worktree-agents-autostash
description: Concurrent agents in ONE working tree auto-stash each other's uncommitted work and mix edits into your files; use a worktree per agent, else commit early and stage by hunk
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
5. **Prefer isolation over recovery:** give each concurrent code-writing agent its
   own worktree (`isolation: "worktree"`) — see
   [[gotcha_worktree_needs_node_modules_and_generated]] for the setup it needs. If
   you must share the checkout, filter with `vitest -t '<describe name>'` to prove
   only your own tests.

**Continuing another agent's branch is REFUSED by default.** Worktree isolation
has a second edge: when you are told to add a commit to an existing feature
branch, that branch is usually still checked out in the worktree of the agent
that created it, and `git checkout <branch>` dies with
`fatal: '<branch>' is already used by worktree at …`. `git worktree list` names
the holder and the commit it sits on; when that matches the commit you were
handed, the sibling is finished and
`git checkout --ignore-other-worktrees <branch>` is the way in. Check the holder
first — two live worktrees on one branch diverge silently.

Related: [[build_typecheck_scope]], [[project_offline_migrations]].
