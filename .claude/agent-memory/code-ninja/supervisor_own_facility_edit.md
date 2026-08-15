---
name: supervisor-own-facility-edit
description: Supervisors may edit their OWN assigned facilities despite the RBAC matrix marking the role read-only — a deliberate product override (PROF-002), not a permissions bug
metadata:
  type: project
---

`updateFacility` deliberately admits `supervisor` for facilities on their own
active `OrganizationUserFacility` rows, even though the RBAC registry gives the
role no `facility.edit` and the RBAC review document calls Supervisor read-only
org-wide. The grant is narrowed to name/type/address and never allows
reassigning the facility's supervisor.

**Why:** PROF-002 in `multi_facility_notes.pdf` (the same source as the
dashboard metric definitions — see [[dashboard-metrics-glossary]]) explicitly
requires supervisors to maintain their own facility's details. The RBAC
demotion was about ORG-wide scope; this exception is facility-scoped, which is
the axis the registry cannot express (`facility.read` is held by every role —
scope, not verbs, is what separates the tiers; see `src/lib/facility/scope.ts`).

**How to apply:** Treat a supervisor writing to their own facility as correct,
not a privilege-escalation regression — if a test or reviewer flags it, point at
PROF-002 rather than "fixing" it back to a blanket deny. Any *new* facility
mutation should keep the same shape: cheap `can()` gate first, ownership proven
against `organizationUserFacility` second, and an explicitly enumerated writable
field set for the exception branch so a hand-crafted payload cannot widen it.
Related: [[org-facility-split]], [[rbac-role-model]].
