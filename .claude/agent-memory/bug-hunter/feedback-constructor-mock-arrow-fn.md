---
name: feedback-constructor-mock-arrow-fn
description: vi.fn().mockImplementation must use a regular function (not arrow) when the mock is used as a `new` constructor target
metadata:
  type: feedback
---

Always use a regular `function` (not an arrow function) in `mockImplementation` when the mock will be invoked with `new`:

```ts
vi.fn().mockImplementation(function () {
  return { upload: mockUpload, ... };
})
```

**Why:** Arrow functions lack `[[Construct]]` and Vitest throws `TypeError: ... is not a constructor` at runtime. Vitest even logs a warning: "The vi.fn() mock did not use 'function' or 'class' in its implementation". Encountered when mocking `MinIOProvider` in the storage fallback integration test (`src/lib/storage/gcs-provider.test.ts`).

**How to apply:** Any time a `vi.mock()` factory wraps a class (constructor) that will be called with `new` — check that `mockImplementation` uses `function() { return {...}; }`, not `() => ({ ... })`. The regular function's explicit object return is what `new` uses as the constructed value.

See also: [[project-test-framework]]
