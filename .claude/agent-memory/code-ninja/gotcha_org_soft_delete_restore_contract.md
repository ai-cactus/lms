---
name: org-soft-delete-restore-contract
description: Organization.deletedAt (PR A, 2026-10-08) — restore keys on deactivatedAt == deletedAt; choke point is the membership lookups, not a Prisma extension
metadata:
  type: project
---

Org soft delete writes `Organization.deletedAt` and `OrganizationUser.deactivatedAt` from ONE Date; restore reactivates only rows where they are equal (and user not deleted). Any new writer that deactivates memberships in a deleted org breaks restore silently.

**Why:** restore must bring back exactly the members active at delete time, not people an admin removed earlier.

**How to apply:** session-scoped code needs nothing (listActiveMemberships/getActiveMembership require `organization.deletedAt: null`). Cross-tenant crons that read by organizationId must filter via `src/lib/organization/deleted.ts`; never add the filter to the db/index.ts extension (GCS sweepers must still see deleted orgs' files). `createMembership` now ALWAYS takes `lockOrganizations` and reads `tx.organization.findUnique`, so tx mocks need `$queryRaw` + `organization`. A new MembershipResolution kind `org_deleted` exists; see [[gotcha_partial_prisma_mocks_break_on_new_query]].
