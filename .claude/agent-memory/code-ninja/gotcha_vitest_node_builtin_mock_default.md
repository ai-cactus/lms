---
name: vitest-node-builtin-mock-default
description: vi.mock of a node builtin (fs/promises, child_process) must also return a `default` key, or the import throws "No default export is defined on the mock"
metadata:
  type: project
---

When mocking a Node builtin in this repo's vitest setup, the factory must return BOTH the named exports and a `default` object:

```ts
vi.mock('fs/promises', () => ({
  stat, unlink,
  default: { stat, unlink },
}));
```

**Why:** something in the transitive import graph (tsx/vite's CJS-ESM interop for builtins) resolves these modules via their default export, so a named-only factory fails at import time with `[vitest] No "default" export is defined on the "fs/promises" mock` — and the error points at a comment line in the *importing* file, which reads like a syntax error rather than a mock problem.

**How to apply:** any test that mocks `fs/promises`, `child_process`, `os`, `path`, etc. Third-party packages (`minio`, `@google-cloud/storage`, `@/db/index`) do NOT need this — named exports alone work there.

**Second trap in the same mock — read the callback as the LAST argument, never a fixed position.** `promisify(execFile)` appends the callback to whatever the caller passed, so a mock typed `(cmd, args, opts, cb)` silently swallows the callback of any call made WITHOUT an options object. In `scripts/transcode-worker.ts` that is exactly `probeDurationSeconds` (`execFileP('ffprobe', [...])`, no opts): the mock's `cb` is `undefined`, calling it throws, `probeDurationSeconds`'s own `catch` maps it to `null` — so every probe silently reports "unknown duration" and any assertion that depends on the probed value passes vacuously. Use `(...callArgs) => { const cb = callArgs[callArgs.length - 1]; … }`.

Related: `scripts/transcode-worker-encode.test.ts` also shows how to test a script whose `main()` runs at module level — set `process.argv`, `vi.resetModules()`, dynamic `import()`, then `vi.waitFor` on the mocked terminal DB write, since `main()` is never awaited by the module.
