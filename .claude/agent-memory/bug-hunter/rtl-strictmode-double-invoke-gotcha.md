---
name: rtl-strictmode-double-invoke-gotcha
description: Manually wrapping renderHook/render in <StrictMode> via a custom `wrapper` does not reliably trigger React's dev-mode effect double-invoke in this repo's RTL/React versions — use the `reactStrictMode: true` option instead
metadata:
  type: feedback
---

To regression-test a StrictMode-only bug (e.g. `src/hooks/use-job-status.ts`'s
`hasStartedRef` guard/teardown split, fixed 2026-07-17), you need the
setup → cleanup → setup double-invocation React performs on mount in
development.

**Do NOT** reproduce this with a hand-rolled wrapper:
```ts
const wrapper = ({ children }) => createElement(StrictMode, null, children);
renderHook(() => useThing(), { wrapper });
```
Verified empirically (React 19.2.3, `@testing-library/react` ^16.3.2, Vitest
4, jsdom) that this does **not** double-invoke effects — the spy fires once,
cleanup zero times — even though the resulting fiber tree looks identical to
the working case.

**Do** use RTL's built-in option instead:
```ts
renderHook(() => useThing(), { reactStrictMode: true });
```
This reliably double-invokes (setup called twice, cleanup once), matching
real `next dev` behavior.

**Why (root cause, in case it recurs elsewhere):** `render()`/`renderHook()`
build the tree as `strictModeIfNeeded(wrapUiIfNeeded(ui, wrapper),
reactStrictMode)` — the `reactStrictMode` option wraps the *actual root
element* passed to `ReactDOMClient.createRoot(...).render(...)` in
`<StrictMode>`. A custom `wrapper` instead nests `<StrictMode>` one
function-component layer *inside* that root. React's
`recursivelyTraverseAndDoubleInvokeEffectsInDEV` walks fiber `subtreeFlags`
from the HostRoot down and should in principle still catch a nested
`<StrictMode>` fiber — but empirically it did not in this stack. Did not dig
further into the exact internal cause once the reliable alternative
(`reactStrictMode: true`) was confirmed working; if this resurfaces, sanity
first with a throwaway spy test before trusting either approach.

**How to apply:** for any hook/component test asserting StrictMode-specific
behavior (double-mount safety, effect idempotency), use
`renderHook(fn, { reactStrictMode: true })` / `render(ui, { reactStrictMode:
true })`, never a hand-rolled `<StrictMode>` wrapper. Sanity-check any new
StrictMode regression test against the pre-fix code (e.g. `git stash push --
<file>`) to confirm it actually fails there before trusting it as a guard.
