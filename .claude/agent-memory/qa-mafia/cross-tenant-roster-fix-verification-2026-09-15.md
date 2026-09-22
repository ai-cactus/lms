---
name: cross-tenant-roster-fix-verification-2026-09-15
description: PRs #619-622 verified PASS live on staging (400ad6c) — cross-tenant roster PII fix, due-date clear, video-discriminator no-op, all confirmed with a genuine two-tenant fixture built from B4 + D01
metadata:
  type: project
---

**Verified PASS 2026-09-15 on staging (`400ad6c`, PRs #619-#622 promoted in #623).** Full report: `qa-reports/2026-09-15-staging-fix-verification-619-622.md`. All 5 stories, 17/17 criteria PASS.

**Fast two-tenant video-course fixture recipe (no new org needed): "Personal Conduct Series 1" (`courseId=1728b9a3-5c46-49be-853a-c7528d1deae5`) is a true global-catalog course adopted by BOTH B4 (5 learners) and D01 (D01 Worker + D01 Finance as of 2026-09-21 — do not withdraw either).** It is now a standing two-tenant fixture. To rebuild the shape elsewhere: log into the org with no learners on a course the other org has, open it by direct URL, click Assign → add an email via the free-text "Add people, emails or names" field + "Invite" button → Assign Course. Takes under 2 minutes and gives you a real two-org roster on one course without touching B4's fixture at all. Re-usable any time a future round needs the "two tenants, one adopted video course" shape again — check `/dashboard/courses` "Video" tab row counts first (the org with the lowest/zero count on a course the other org has is your target).

**CONFIRMED FIX — `getCourseById` cross-tenant roster leak is closed.** B4's roster (5 names) and D01's roster (1 name) stayed completely disjoint in both directions, re-verified on both sides after the D01 enrollment landed (not just a one-way check). Course-list "Assigned Staff" column count matches the detail page's "Total Learners" stat exactly on both sides (5 and 1, never the combined 6) — a good sanity cross-check for any future roster-scoping claim: if the list-row count and the detail-page stat ever disagree, that's a signal something's still leaking or double-counting.

**CONFIRMED FIX — Due Date can now genuinely be cleared** (previously it could only be set, never removed — before PR #620). A "Clear due date" icon-button appears next to the date once set; clicking it, saving, and reopening shows a real empty state (placeholder text, no leftover time). **Training Schedule got the same "Clear schedule date" affordance too** (unprompted regression-adjacent improvement, not itself the target of this story).

**Per-person due-date default is NOT retroactive — only NEW enrollments after a clear get `today+30`; already-enrolled people keep their previously-computed due date frozen.** Tested by clearing a shared Sep-15-2026 deadline then adding two people: one already-enrolled (kept "Due Sep 15, 2026" unchanged) and one brand-new (got "Due Oct 15, 2026" = today+30). This is correct/intended per the field's own copy ("counted from when they start the course or join the role") — don't mistake the already-enrolled person's unchanged date for a bug in a future round.

**The "Add people, emails or names" free-text field on the Assign page has NO autocomplete/search dropdown for existing staff — confirmed via DOM inspection (no `[role=listbox]`/`[role=option]` ever renders) and zero network requests fired while typing.** You must already know (or separately look up via Staff Management) the exact email address; typing a partial name does nothing. This slowed down fixture-building — budget for a Staff Management lookup detour whenever a story needs you to add a specific existing person by name rather than by known email.

**"Assign Course" submit stays disabled if you only touch Due Date/Renewal/Reminders on an already-assigned course without adding anyone in the "Add people" field — re-add an already-enrolled person (harmless, they're already in) to re-enable it.** Reconfirms the same workaround documented in [[dashboard-scoping-fix-2026-09-14]] for the role-target-removal case; this generalizes to *any* field-only edit on the standalone assign page for an existing assignment.

**D01 admin's password was reset this round** via the standard forgot-password + QA Gmail IMAP flow, with no rate-limit friction. Current credentials: see [[staging-two-facility-fixture-recipe]].

See [[staging-two-facility-fixture-recipe]], [[dashboard-scoping-fix-2026-09-14]], [[assign-surface-consolidation-2026-09-14]], [[course-delete-and-withdraw-mechanics]], [[qa-gmail-imap-quirks-and-ui-bypass-technique]] for related background.
