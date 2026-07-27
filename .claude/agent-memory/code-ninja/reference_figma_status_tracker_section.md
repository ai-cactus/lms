---
name: reference-figma-status-tracker-section
description: Figma STATUS TRACKER section node ids and the fact that LMS-203 and the dashboard's LMS-201 are byte-identical renders of the same page
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, page "LMS v2 (Updated)", section
**STATUS TRACKER = `14568:76289`**.

| node | name | what it is |
|---|---|---|
| `14568:76909` | LMS - 203 | `/dashboard/status-tracker` — breadcrumb, 33.5px title + red "N at risk" pill, one card with the caption "Assignments due within 7 days or already overdue.", a **single merged table** (Staff Name w/ avatar + subtitle, Course, Deadline, Status pill, View), pagination footer |
| `14568:80794` | Staff details | the staff profile reached from the View link — belongs to the **staff** slice (`/dashboard/staff/[id]`), not this one |

**`14568:76909` (LMS-203) and `14568:74844` (LMS-201, in the LMS DASHBOARD section) render
byte-identical PNGs** — same frame content duplicated across sections, so there is nothing to
reconcile between them. There is **no mobile frame** for this page.

Design facts worth reusing: status pills are `#fee4e2`/`#d92d20` dot/`#b42318` text for overdue and
`#fef0c7`/`#f79009`/`#b54708` for due-soon, both `px-[14.4px] py-[6px]` fully-rounded with a 7.2px
dot — the same pill is reused as the header's "N at risk" chip. The card declares a fixed
`h-[732.533px]`, which is just the natural height of a 10-row page; do not hard-code it (siblings
size to content).

Figma's own header/body column widths disagree by 10–15px in this frame (header Staff 284 / body
272, header Status 206 / body flex). The **body** widths are what the render shows: Staff 275,
Course 271, Deadline 191, Status 211, Action 78 within a 1026px inner card.

See [[reference-figma-lms-v2]] and [[reference-figma-courses-section]].
