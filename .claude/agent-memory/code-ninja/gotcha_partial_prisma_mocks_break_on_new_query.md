---
name: partial-prisma-mocks-break-on-new-query
description: Adding a query to a shared lib reddens unrelated action tests with "Cannot read properties of undefined (reading 'findMany')" — their vi.mock('@/lib/prisma') is a hand-written partial
metadata:
  type: feedback
---

Every action test in this repo mocks `@/lib/prisma` with a hand-written object
listing only the delegates that action happened to use. There is no proxy and no
`mockDeep`. So the moment a shared helper you call adds a query on a NEW model,
every one of those suites dies at import-time-ish with

    TypeError: Cannot read properties of undefined (reading 'findMany')
     ❯ listAdoptedCourseIds src/lib/course/org-scope.ts:23

**Why:** the stack trace points at the *library*, not at the test's mock, so it
reads like a production bug in code you just wrote. It is not — it is a missing
key in `vi.mock('@/lib/prisma')`.

**How to apply:** when a change routes an action through a new shared helper,
before concluding anything about correctness, grep the failing test's prisma mock
for the delegate named in the trace. Temporarily add the missing key, re-run, and
only then judge which assertions genuinely disagree with the new behaviour. In
practice the split is stark — e.g. on the dashboard-scope PR, 22 failures were
all one missing `orgCourseOffering.findMany` / `course.count` /
`enrollment.aggregate`, and exactly ONE assertion was a real behaviour change.
Report the mock gap to bug-hunter rather than editing the suites yourself.

See also [[gotcha_sweep_test_mock_queue_coupling]].
