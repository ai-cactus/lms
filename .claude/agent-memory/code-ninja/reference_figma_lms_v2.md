---
name: reference-figma-lms-v2
description: Where the LMS v2 redesign lives in Figma, and which DOCUMENT HUB frames are real targets vs unbuilt-feature concepts
metadata:
  type: reference
---

The UI redesign source of truth is Figma file key `cySAabdYLDKzwbs88owBHn`, page **"LMS v2 (Updated)"**. Sections are named per area (e.g. `12539:32941` = ADMIN / DOCUMENT HUB).

**Frame naming is "LMS - <n>", and a higher n is NOT reliably the frame you want.** In DOCUMENT HUB the highest-numbered frame (`14830:46146` "LMS - 205") is an empty state for a **folders** feature that does not exist in the app ("No folders yet" / "Create your first folder"); the real populated list-page design is the older `13495:161914` (LMS - 141) and `13495:162119` (LMS - 142, kebab menu open, search moved left). `12549:69582` (LMS - 66) is the **course** detail page, not the document detail page.

**Why:** picking a frame by number alone sends you implementing an unshipped feature or the wrong page entirely. Several frames in a section are concepts, alternate states, or belong to a neighbouring flow.

**How to apply:** before implementing, screenshot the whole section node at `maxDimension` ~2000 to see every frame at once, then screenshot the specific candidates and identify them by content — not by name. Cross-check that the frame's columns/affordances exist in the app before treating a difference as a bug to fix. Note also that some sections have **no** frame for a page you were asked to match (DOCUMENT HUB has none for `/dashboard/documents/[id]` or the upload modal) — say so rather than inventing a design. See [[local-ui-verification]] for driving the running app to compare.
