---
name: reference-figma-staff-section
description: Figma STAFF section frame→page map (list, profile, mobile) plus the profile design's data gaps vs the product's real enrollment states.
metadata:
  type: reference
---

Figma file `cySAabdYLDKzwbs88owBHn`, STAFF section. Key frames:

- `13495:163724` / `14004:118071` — **Staff Profile** (desktop, 1440×1726). `14004:118608` is the
  same frame re-exported; treat them as one design.
- `13495:...` staff_list — Staff Details (roster list).
- `14833` — roster empty state. `14519:*` — staff modals (invite / remove / limit).
- mobile 375 frames exist for list + profile, but the **mobile profile frame is a different,
  simplified concept** ("My Courses" name-only list + "Courses Completed" with Verify links).
  It does not match the desktop information architecture — don't try to reconcile them; make the
  desktop design responsive with the usual column-hiding instead.

**Staff Profile design vs. product data — the design frame is thinner than reality:**

- Trainings Status column shows only `In progress` / `Attested` / `Failed`. The product also has
  `Passed` (completed above passing score, not yet attested) and `Locked` (+ "Limit reached"
  caption, attempts exhausted) — both are real states with no design counterpart, so they were kept.
- The design's red `Retry` action sits on its **Failed** row, but `assignRetake()` only accepts
  `status = 'locked'`. So the red Retry link belongs on **Locked** rows, not Failed ones —
  the design's row can't be reproduced literally without inventing business logic.
- The design shows a `View` link on every row; a quiz result only exists once there are attempts,
  so that column is legitimately empty on never-started enrollments.
- Certificates rows use a colour medal emoji illustration; the kit equivalent is lucide `Award`
  in a tinted tile (see [[reference-figma-lms-v2]] for the no-inline-svg rule).

**Roster list frame — the five columns do not fit at `lg`.** The design is drawn at 1440, where
the table gets 1026px. At **1024** the shell (280 sidebar + 46×2 + card 21×2) leaves only
**608px**, which cannot hold Name + Role + Facility + Date + Action. Fixed px widths there
starve Name down to its avatar (names and emails vanish entirely) — the fix is to drop **Date
Added** between lg and xl (`hidden sm:table-cell lg:hidden xl:table-cell`) and to size the
columns by **percentage from xl up** (Role/Facility 17%, Date 15%, Action 18%, Name takes the
33% remainder) so 1280 and 1440 both stay balanced. Fixed px at xl looks fine at 1440 and
breaks at 1280 — always measure both. The "View profile" link is `hidden xl:inline-flex`
because its ~121px cluster has no room below xl.

Measured tokens unique to this frame (rest is the standard kit): red deadline chip
`bg #fff1f1 / text #d31616`; Attested + Approved pill `bg #eaf2fc / text #0e69f3`;
plain deadline text `#525252`, plain completion date `#3e4558`.

Related: [[reference-figma-lms-v2]], [[project-figma-to-css-scale]].
