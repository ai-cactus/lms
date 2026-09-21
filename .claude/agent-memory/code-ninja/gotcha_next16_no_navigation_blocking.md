---
name: gotcha-next16-no-navigation-blocking
description: Next 16 can cancel a Link click (onNavigate) but NOT browser Back — App Router serves it as an uncancellable popstate beforeunload never sees; the sentinel workaround and the two Next internals that make it safe
metadata:
  type: project
---

Next.js 16.3.x ships **no navigation-blocking API** — no `useBlocker`, and
`router.push`/`popstate` cannot be cancelled. Verified against the live docs
(nextjs.org/docs/app/api-reference/components/link, v16.3.5) on 2026-09-21, and
the Next team has still not responded to the long-running request.

What *does* exist:

- `<Link onNavigate={(e) => e.preventDefault()}>` (v15.3.0+) cancels a **link
  click** only. The docs' own "Blocking navigation" recipe is built on it.
- `beforeunload` covers tab close and reload.

Neither sees the **browser Back button**: the App Router handles it as a
client-side `popstate`, so any unsaved-work guard built only from those two has
a silent hole. Guarding it needs history interception — say so in the PR, and
comment it at the call site as a workaround.

**Two Next internals that make the sentinel workaround safe** (both in
`node_modules/next/dist/client/components/app-router.js`):

1. Next **patches `window.history.pushState`/`replaceState`** to copy its own
   `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE` keys onto whatever state object
   you pass. So `history.pushState({ mine: true }, '')` keeps working.
2. Its `popstate` handler does `window.location.reload()` for any entry whose
   state lacks `__NA`. Without (1) a hand-pushed entry would hard-reload the
   page on Back — which would lose the edits you were protecting.

Pass **no url** to `pushState` (2 args): a truthy `url` makes the patch dispatch
an extra `ACTION_RESTORE` for a URL that has not changed.

**The rule that outranks the feature:** never re-push the sentinel while the
confirm dialog is open. That is what makes Back unable to leave at all, which is
worse than losing the edits, and it also breaks confirm (`history.back()` lands
back on the reinstated sentinel). Spend the sentinel, prompt, and let an
insistent second press through.

Implemented as `src/hooks/use-unsaved-changes-back-guard.ts` (PR
`fix/slide-editor-back-guard`); jsdom implements real session history, so
`pushState`/`back()`/`popstate` can be unit-tested for real.

Related: [[gotcha_rhf_watch_react_compiler]], [[project_course-wizard-9-step]].
