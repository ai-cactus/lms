---
name: reminders-test-patterns
description: Reminder/escalation engine test patterns, gotchas, and coverage notes
metadata:
  type: project
---

## Test coverage for src/lib/reminders/

`src/lib/reminders/` has 9 modules; every one except `email-sender.ts` has a test file.

### Pure-function modules (no mocks)
- `time.test.ts` — localDateKey, startOfDayInTz, addDays, diffInDaysInTz
- `us-state-timezone.test.ts` — deriveTimezoneFromState
- `deadline.test.ts` — resolveStartDate, computeDueAt, resolveDefaultDueWindowDays (env var)
- `stages.test.ts` — REMINDER_STAGE_DEFAULTS offsets + audiences, SWEEP_STAGES excludes INITIAL_LAUNCH

### DST gotcha: midnight Nov 3 (NY fall-back) is in EDT, not EST
Fall-back happens at 02:00 local = 06:00 UTC. Midnight local is BEFORE the transition → still EDT (UTC-4). So `startOfDayInTz('2024-11-03T12:00:00Z', 'America/New_York')` = `2024-11-03T04:00:00.000Z`, not 05:00.

### P2002 idempotency testing in dispatch.test.ts
`dispatch.ts` imports `{ Prisma }` from `@/generated/prisma/client`. Mock `@/generated/prisma/client` to export a fake `Prisma.PrismaClientKnownRequestError` class via vi.hoisted. Both the mock and the module-under-test share the same class reference, so `instanceof` passes correctly.

```ts
const { MockPrismaKnownRequestError } = vi.hoisted(() => {
  class MockPrismaKnownRequestError extends Error {
    code: string; clientVersion: string;
    constructor(msg: string, { code, clientVersion }: { code: string; clientVersion: string }) {
      super(msg); this.code = code; this.clientVersion = clientVersion;
    }
  }
  return { MockPrismaKnownRequestError };
});
vi.mock('@/generated/prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaKnownRequestError },
}));
```

### LadderStageInput shape (sweep dispatch call)
`dispatchLadderStage` receives `enrollment: { id, userId, courseId }` (an object), NOT `enrollmentId`. Assertion must use `expect.objectContaining({ enrollment: expect.objectContaining({ id: 'e1' }) })`.

### sweep.test.ts mock ordering for enrollment.findMany
`runReminderSweep` shares `enrollment.findMany` between Track A/B and 4 pre-passes (retry, retention, role-target-reconcile, renewal-retrigger). Read [[phase2-fix-round-test-patterns]]'s queue-corruption gotcha before chaining `mockResolvedValueOnce`: a pre-pass that short-circuits consumes no slot.

### Fake timers for compliance.ts
`getOverdueComplianceForOrg` calls `new Date()` internally. Use `vi.useFakeTimers()` + `vi.setSystemTime(NOW)` in beforeEach, `vi.useRealTimers()` in afterEach.

### e2e spec location
`tests/e2e/reminders.spec.ts` runs in CI-parity `npm run e2e:local`. Only REM-003 skips, and only when `PLAYWRIGHT_SYSTEM_ADMIN_COOKIE` is unset.

### Enrollment.test.ts fix (pre-existing)
Added `sendCourseLaunchEmail: vi.fn().mockResolvedValue(undefined)` to the `@/lib/email` mock block. Phase 7 added this import to enrollment.ts but the test mock didn't export it.
