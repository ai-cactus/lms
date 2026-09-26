---
name: gotcha-scratchpad-shared-across-agents
description: The session scratchpad dir is shared by parallel agents in other worktrees — generic log names (shards.log) collide; use a unique subdir
metadata:
  type: feedback
---

Parallel subagents in different worktrees get the SAME scratchpad directory. On
2026-09-27 another agent's `shards.sh` appended "=== shard N/4" results for ITS
worktree into the same `shards.log` I was writing, so a monitor reported another
branch's failures as mine.

**Why:** the scratchpad is per orchestrator session, not per worktree.

**How to apply:** write logs under a unique subdirectory (e.g. `scratchpad/<branch-slug>/`)
and check the `RUN v… <path>` header of any vitest log names YOUR worktree
before trusting its verdict.
