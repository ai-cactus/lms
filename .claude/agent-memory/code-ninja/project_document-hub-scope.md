---
name: document-hub-scope
description: Product decisions for the Document Hub — rename dropped from the UI; list hover preview card cut, but the viewer's thumbnail rail was reinstated
metadata:
  type: project
---

Two Document Hub decisions confirmed by the user on 2026-08-13, during the Figma
"Document Hub" reconciliation on branch `multi-facility`:

1. **Renaming a document is gone from the product.** The kebab is exactly
   Download / Delete. The `renameDocument` server action stays in
   `src/app/actions/documents.ts` (still covered by its own tests), but no UI
   reaches it and none should be added back.
2. **The list's hover preview card (Figma Hub-9) is cut from the design** —
   removed, not deferred.

**Why:** both came straight from the design owner while the reconciliation was in
flight — the mocks that showed them are superseded.

**How to apply:** do not reintroduce a rename affordance or a list hover preview
when working the Documents area; treat any older mock showing them as stale. If a
task asks for either, confirm with the user first.

**Reversed on 2026-08-13 (same day):** the viewer's left page-thumbnail rail was
briefly recorded here as cut too, then explicitly ruled back IN for
`/dashboard/documents/[id]` — the full-screen viewer must have the rail, and it
carries page navigation now that the zoom controls and the "Page N of N" pager
were removed (design has no toolbar above the content). The meta line there is
the facility chip + "Uploaded … ago" only. Don't re-add a viewer toolbar or extra
meta fields, and don't trust the "no rail" wording elsewhere. See
[[supervisor_own_facility_edit]] for another ruling that reads like a bug but isn't.
