---
name: gotcha-shadcn-table-row-border
description: Killing the shadcn TableHeader row divider needs border-none, not border-0 — TableHeader's [&_tr]:border-b outranks any class on the TableRow
metadata:
  type: reference
---

To render a shadcn `<Table>` with **no** divider under the header row, put `border-none` on the header `<TableRow>` — `border-0` does not work.

`TableHeader` carries `[&_tr]:border-b`, which compiles to a descendant selector (specificity 0,1,1) and therefore beats any width utility you pass on the `<TableRow>` itself (0,1,0). `border-0` only zeroes `border-width`, so the header keeps a 1px dashed `#e2e8f0` line from `TableRow`'s base classes. `border-none` sets `border-style: none`, for which no competing rule exists, so the line disappears.

Body rows are unaffected — `TableBody` adds no `[&_tr]` border rule, so `border-0`/`border-none` both work there.

Related `Select` traps (both verified in the running app, 2026-07):

- `SelectTrigger` **no longer carries any `data-[size=…]` height class** — the `size` prop and its
  `data-[size=default]:h-9` were removed from `src/components/ui/select.tsx`, so a plain
  `h-[41px]` in `className` now works. Don't add `data-[size=default]:*` pairs any more; check the
  file before trusting the older "the size prop is inert" note in
  [[gotcha_dashboard_responsive_breakpoints]].
- **`SelectValue` silently drops `className`** (Radix renders its own inner span — the DOM node
  ends up with `class=""` and no `data-slot`). Style the value by putting the font/colour classes
  on the `SelectTrigger` and letting them inherit; for layout, use child selectors on the trigger
  (e.g. `[&>svg:last-child]:ml-auto` to push the chevron right when the trigger is `justify-start`).
