---
name: gotcha-dashboard-responsive-breakpoints
description: the 280px sidebar makes `lg` narrower than `md`, so gate wide tables at `xl`; SelectTrigger has no size prop — set height with a plain h-* class.
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

**2. `SelectTrigger` has no `size` prop.** `src/components/ui/select.tsx` no longer accepts
`size` or emits `data-size`, and carries no default height class. To get the LMS-v2 40px
pagination select, pass a plain `h-10` in `className`. Don't add `data-[size=…]:*` overrides —
nothing matches them. See [[gotcha_shadcn_table_row_border]].

See [[reference-figma-courses-section]] for the shared card/table/pagination token set and
[[local-ui-verification]] for driving the running app.
