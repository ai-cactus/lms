---
name: feedback-permission-defect-methodology
description: Two confirmed methodology rules for reporting RBAC/permission findings on this app - always pair a denial with a positive control, and separate "gate is wrong" from "gate is right but no UI calls it"
metadata:
  type: feedback
---

**Rule 1 — When a role appears blocked from something the matrix says it should have, always reproduce the identical action/URL as a role that SHOULD succeed (a positive control) before reporting it as a defect.**

**Why:** confirmed 2026-09-17 during [[rbac-directive-round-2026-09-17]] — HR getting a 404 on a quiz-results page reads as ambiguous ("HR couldn't see a page") on its own. Reproducing the exact same URL as Owner (who succeeded) isolated the cause to one specific stale authorization check (`isCourseCreator` in `getEnrollmentWithResults`) rather than the page's RBAC gate, missing data, or a session issue. The orchestrator explicitly called this out as what turned the finding into an actionable defect rather than a vague observation.

**How to apply:** any time a role-scoped denial shows up (a 404, a hidden button, an empty state that might be a permissions artifact), before writing it up, find or create a second account that the registry says SHOULD have access and try the identical action. Report both results side by side.

---

**Rule 2 — When a permission-registry grant + its server-side enforcement are correct, but no UI control exists to invoke the action, report this as its own separate cross-cutting note — never fold it into a role's pass/fail table as if it were an RBAC gate defect.**

**Why:** confirmed 2026-09-17, same round — `updateStaffDetails` (staff profile edit + re-role) is a correctly-authorized server action with zero UI callers anywhere in the product (`canEdit` in `StaffProfileClient.tsx` is dead code). The orchestrator deliberately excluded this from the same-round bug-fix branch that fixed 4 other findings, explaining: "a correctly-authorized server action with no UI caller is a missing feature needing product scoping, not a gate defect... it would have quietly turned a bug-fix PR into a feature PR." My report had already drawn this distinction (BLOCKED, not FAIL, with its own cross-cutting section) and that framing was confirmed correct.

**How to apply:** before marking a criterion FAIL because "role X couldn't do Y," check whether ANY role can do Y through the product UI. If no role can (the control/button/page simply doesn't exist anywhere), that's a missing-feature/scoping question — mark the criterion BLOCKED and describe the gap in its own section, distinct from genuine per-role gate defects (where SOME role can do it live and the denied role's registry entry says they should too).

See [[rbac-directive-round-2026-09-17]] for the full incident these rules came from.
