---
name: gotcha-dashboard-responsive-breakpoints
description: Inside the admin dashboard shell the 280px sidebar makes lg (1024) NARROWER than md (768), so wide table layouts must be gated at xl; plus SelectTrigger's `size` prop is inert
metadata:
  type: project
---

Two traps when making a dashboard content page responsive.

**1. `lg:` is narrower than `md:` inside the dashboard shell.** `DefaultDashboardLayout` pins a
280px sidebar from `lg` up and switches the content padding to `lg:px-[46px]`. Usable content width:

| viewport | usable width |
|---|---|
| 375 | 327 |
| 768 | 720 |
| **1024** | **652** ← *less than 768* |
| 1280 | 908 |
| 1440 | 1068 |

**Why:** the sidebar and the wider padding both switch on at `lg`, so crossing that breakpoint
*loses* ~70px of content width.

**How to apply:** never reveal an extra table column at `lg:` — a layout that fits at `md` will
overflow at `lg`. Gate the full/widest column set at **`xl:`** (1280) and treat `md`→`xl` as one
band. The 1440 Figma frames correspond to the `xl` band. Collapse (`hidden xl:table-cell`) rather
than scroll, per `docs/ui-migration-pattern.md` §3a; also set `table-fixed` on `Table`, otherwise
`truncate` on cell contents does nothing (auto table layout sizes columns to the full nowrap text
and the card overflows).

**2. `SelectTrigger`'s `size` prop is inert.** `src/components/ui/select.tsx` destructures
`size = 'default'` but never emits `data-size`, so the built-in `data-[size=default]:h-9` /
`data-[size=sm]:h-8` rules and any `data-[size=sm]:h-10` override you add never match. To get the
LMS-v2 40px pagination select, pass a plain `h-10` and omit `size` entirely. (ESLint already
reports this as an unused-var warning.)

See [[reference-figma-courses-section]] for the shared card/table/pagination token set and
[[local-ui-verification]] for driving the running app.
