---
name: gotcha-sanitize-allowed-attr-strips-editing-attrs
description: sanitizeHtml's explicit ALLOWED_ATTR silently drops contenteditable/role/spellcheck, while data-* and aria-* survive it — DOMPurify defaults you cannot see in the config
metadata:
  type: project
---

`src/lib/sanitize.ts` passes an explicit `ALLOWED_ATTR` list, so any attribute
not in it is stripped **silently** — the element survives, the attribute does
not. Two behaviours matter and neither is visible in the file:

- `data-*` and `aria-*` **do** survive anyway (DOMPurify's `ALLOW_DATA_ATTR` and
  `ALLOW_ARIA_ATTR` default to true, independently of `ALLOWED_ATTR`).
- `contenteditable`, `role` and `spellcheck` do **not**. They must be listed.

**Why it bites:** anything that decorates course HTML before injecting it — the
in-place slide editor is the first — renders fine, keeps its `data-` hooks, and
then just isn't editable, with no error anywhere. The wrong conclusion is "React
stripped it" or "jsdom doesn't do contenteditable".

**How to apply:** don't widen `SANITIZE_CONFIG` for an editing surface — nothing
on the learner path should be able to ship a `contenteditable` element. Add a
second config + exported function (`sanitizeEditableHtml` is the precedent) and
keep the reader's sink untouched. Verify a new attribute with a two-line
`isomorphic-dompurify` script rather than reasoning about it; the script must
run from inside the worktree so it can resolve node_modules.

Related: [[gotcha_worktree_needs_node_modules_and_generated]].
