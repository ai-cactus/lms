---
name: long-wait-tests-must-stay-synchronous
description: Correction — never background a shell `sleep` and yield the turn while waiting on a multi-minute UI condition (e.g. session-timeout tests); do the wait inside one synchronous playwright-cli run-code call instead
metadata:
  type: feedback
---

**Rule:** when a test needs to wait several minutes for a live UI condition (e.g. an inactivity-timeout warning/expiry), do the entire wait **inside a single synchronous `playwright-cli run-code` script** using Playwright's own passive waiters (`page.waitForSelector(...)`, `page.waitForURL(...)`, `page.waitForTimeout(...)` for pacing between deliberate actions) — never `run_in_background: true` a shell `sleep` and end the turn to "wait for the notification."

**Why:** a backgrounded `sleep` produces a task-completion notification, but nothing else about the browser state advances or gets inspected during that time from the agent's side, and the orchestrator sees the turn end with no observable progress — from their point of view the agent "yielded while waiting on an idle timer" with no live background work to resume it. It also loses precision: by the time the notification round-trips and the next turn starts, extra wall-clock time has elapsed beyond the target window (observed: a 65s background sleep effectively became 100+ seconds of real idle time once conversation-turn overhead was added), so "warning should appear at ~60s" degrades into "warning had already appeared and possibly resolved by the time I checked."

**How to apply:** for any test needing a multi-minute wait on live browser state:
1. Read the exact timing constants from source first (e.g. `InactivityTimer.tsx`'s `TIMEOUT_MS`/`WARNING_MS`/`checkInterval`) so the script's timeouts are generous but not wasteful.
2. Write ONE `run-code` invocation that does all the waiting+asserting+logging in-page (`page.waitForSelector`, `page.waitForURL`, looped `page.waitForTimeout` + real `page.keyboard.press(...)`/`page.mouse.click(...)` for activity-simulation tests), and `return JSON.stringify({...timestamps, booleans...})` at the end so the single Bash call surfaces a complete, structured result.
3. Invoke that via the normal `Bash` tool (not `run_in_background`) with a `timeout` parameter sized to the script's total possible wait (up to the 600000ms cap) — this keeps the turn alive and blocking for the full duration, which is the correct behavior when the orchestrator is waiting on the result synchronously.
4. Only use `run_in_background` for genuinely fire-and-forget work the agent doesn't need to inspect moment-to-moment (e.g. a long build), not for "wait then check a UI state" patterns.

See [[phase5-platform-wide-patterns]] for the session-timeout test this was learned on (TC-061/TC-062, 2026-07-17) — the synchronous `run-code` approach produced clean, precise, millisecond-accurate timing evidence on the very next attempt.
