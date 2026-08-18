---
name: figma-to-css-scale
description: LMS v2 Figma frames are drawn ~1.12x oversized vertically/typographically — horizontal geometry is 1:1, row heights and font sizes must be divided by ~1.12
metadata:
  type: project
---

The "LMS v2 (Updated)" Figma frames do **not** map 1:1 to CSS pixels. The established
app convention (converged on independently by the Documents, dashboard, and Staff
slices) is:

- **Horizontal geometry: 1:1.** Content card width 1068, card padding 21, card radius
  17, search input width 470/506, icon boxes 40 — take these straight from Figma.
- **Vertical rhythm and type: divide by ~1.12.** Figma table header 45.9 → `h-[41px]`;
  Figma row 78–79.4 → `h-[71px]`; Figma text 17.03 → `text-[15.5px]`; 14.6 → `13.5px`;
  pill height 32.1 → `h-[29px]`; stat card 90.6 → `h-[81px]`.

Reusable class constants already encode this — copy them rather than re-deriving:
`tableHeadClass` in `documents/DocumentListClient.tsx`, and `headCls`/`cellCls` in
`dashboard/MyCoursesTable.tsx`.

**Why:** the design context returned by `get_design_context` mixes true-pixel values
(paddings, widths) with values from a scaled frame (fractional sizes like `17.031px`,
`9.732px`, `border-b-[1.216px]`). Implementing the fractional ones literally makes a
page visibly heavier than its neighbours; implementing everything at ÷1.12 makes it
too narrow. Getting this wrong is the single biggest source of cross-page drift.

**Exception — the BILLINGS - OVERVIEW section (`13121:43608`) is 1:1 in BOTH axes.**
Its frames were drawn against the real shell (nav 280, content `px-[46px] py-[40px]`,
title `33.488px` = the app's `text-[33.5px]`), so take every value literally. It also
uses a different neutral palette than the rest of LMS v2 — slate (`#e2e8f0` borders,
`#0f172a`/`#475569`/`#64748b` text, `#f8fafc`/`#f1f5f9` fills, `rounded-[12px]` cards)
rather than the `#dfe1e6`/`#666d80`/`rounded-[17px]` set used by Documents/Staff/Status
Tracker. Don't "correct" one to the other without asking.

**How to apply:** when a Figma number comes back fractional (e.g. `19.464`, `45.861`),
treat it as scaled; when it is a round integer (`24`, `470`, `1068`, `21`) treat it as
true CSS px. Confirm by screenshotting an already-migrated sibling page in the running
app and comparing, rather than trusting the frame alone. See
[[reference-figma-lms-v2]] and [[local-ui-verification]].
