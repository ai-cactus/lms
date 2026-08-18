---
name: gotcha-rhf-watch-react-compiler
description: react-hooks/incompatible-library warns on react-hook-form's watch(); use useWatch({control, name}) instead
metadata:
  type: feedback
---

`npm run lint` (React Compiler ESLint plugin) emits a `react-hooks/incompatible-library`
warning — "Compilation Skipped: Use of incompatible library" — for any call to
react-hook-form's `watch(...)` returned by `useForm()`. It also disables memoization
for the whole component.

**Why:** `watch()` returns a non-memoizable function, so React Compiler bails out of
compiling the component that calls it, which can also cause stale UI in memoized children.

**How to apply:** in client forms, read a live field value with
`useWatch({ control, name: 'field' })` instead of `watch('field')`. Same value, no warning,
component still gets compiled. `register`, `useController`, and `handleSubmit` are fine.
