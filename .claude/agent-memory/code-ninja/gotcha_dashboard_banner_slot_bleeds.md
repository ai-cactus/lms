---
name: gotcha-dashboard-banner-slot-bleeds
description: Site-wide dashboard banners render INSIDE the padded scroll container, so any page using a negative-margin full-bleed hero paints over them
metadata:
  type: feedback
---

`BillingPausedBanner` and `StatusTrackerAlertBanner` are rendered by
`src/app/dashboard/(main)/layout.tsx` as the first children of
`DefaultDashboardLayout`'s content div — which is the padded, scrolling
`overflow-y-auto px-6 py-6 lg:px-[46px] lg:py-10` container, **not** a slot
directly under the NavBar. They are in normal flow and do push content down.

**Why this bites:** any page that uses a negative top margin to bleed out of
that padding (the classic full-bleed hero trick) will pull itself up over a
banner instead of over the padding, and an opaque background then hides the
notice. `CoursePreview` did exactly this with `-m-10` (QA #32). The fix was
`first:-mt-10` on the component root plus `-mx-10` on the hero, so the pull
only applies when nothing precedes it.

**How to apply:** before adding any `-mt-*`/`-m-*` bleed to a page under
`/dashboard/(main)`, gate it on `first:`. Note the two banners are styled
inconsistently — the billing one is a full-bleed `border-b` strip (styling that
assumes it sits outside the padding), the status-tracker one is a contained
`rounded-[12px]` card with `mb-6`. The billing banner also has no bottom
margin, so page content abuts it directly.

Related: [[gotcha_dashboard_responsive_breakpoints]]
