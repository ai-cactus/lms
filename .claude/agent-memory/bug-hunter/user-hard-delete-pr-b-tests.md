---
name: user-hard-delete-pr-b-tests
description: PR B (/system permanent user delete) test notes - audit_logs is append-only in e2e cleanup, transient 2s success text is unreliable to assert, prisma-schema cascade manifest approach
metadata:
  type: project
---

Test files: `src/lib/system/hard-delete-user.test.ts` (ordered-call-log fake, no real DB), `user-relations-cascade-manifest.test.ts` (parses `prisma/*.prisma`, since the generated client has no onDelete), `src/lib/storage/{cleanup,avatar.delete-folder}.test.ts`, modal/detail component tests, `tests/e2e/system-user-hard-delete.spec.ts`.

- `audit_logs` rejects DELETE (trigger needs `SET LOCAL app.allow_audit_purge='on'`): never clean audit rows in e2e afterAll. A throwing afterAll marks the tests failed and, under CI retries, hides it as "flaky".
- The modal's success text is on screen only 2s before redirect; Playwright missed it once. Assert `waitForURL(/\/system$/)` + DB state instead; the text is covered by the RTL test (fake timers with `shouldAdvanceTime` and `userEvent.setup({advanceTimers})`).
- Run e2e with `--retries=0` to see real flakiness (e2e:local sets CI=true => 2 retries).
- Returning (not throwing) from inside `$transaction` still commits, so in-tx refusal order logs include `commit`.
