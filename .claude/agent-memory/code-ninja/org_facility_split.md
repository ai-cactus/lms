---
name: org-facility-split
description: Organization split into Organization + Facility; which fields live where, one-facility-per-org invariant, and facility.* perms (owner+supervisor only).
metadata:
  type: project
---

`Organization` was split into `Organization` + `Facility` (new `facilities` table, `User.facilityId` FK). Migration `20260701130000_add_facility` (authored-only) seeds ONE facility per existing org and attaches all users to it.

**Field ownership (do not read moved fields off `organization` anymore):**
- Organization keeps: name, slug, dba, ein, primaryContact, primaryEmail, isHipaaCompliant, hasAuditorAccess, primaryBusinessType, additionalBusinessTypes, joinCode(+expiry), stripeCustomerId, inactivityTimeoutMinutes, requireMfa.
- Facility holds: address, city, state, country, zipCode, phone, licenseNumber, staffCount, programServices, complianceDocumentUrl/Name, `type` (facility category, added by the Settings page) (+ its own name, organizationId).

**Invariant:** exactly one facility per org today. Facility name+type are now editable via the owner-only **Settings → Facility** tab (`src/components/dashboard/settings/FacilityTab.tsx`), which calls `updateFacility({ name, type })` — the action accepts `name`/`type` on top of the location fields, still gated on `facility.edit`. Every user-creation/attach path sets `facilityId` by `findFirst({ where:{ organizationId } })` — onboarding.ts, onboarding-complete.ts, organization.createOrganization (all in a $transaction), invite/accept route, organization-code joinOrganization, enrollment.enrollUsers (resolved ONCE before the loop), and create-auth-instance OAuth. Facility-not-found → `facilityId: null` + `logger.warn`, never hard-fail.

**Reads that moved to the facility relation:** billing overview/checkout/page (`facilities[0]?.staffCount`), worker & dashboard profile pages, organization-code `verifyOrganizationCode`. `getOrganization()` now returns nested `{ organization, facility }`.

**Permissions:** `facility` is a RESOURCE in permissions.ts; `owner` (everything) + `supervisor` (everythingExceptBilling) auto-hold all `facility.*`; no other role does. `updateFacility` + `uploadComplianceDocument` gate on `facility.edit`; the "Your Facility" tab (FacilityForm) shows only when `facility.read`. `updateOrganization` keeps its existing isAdmin gate (unchanged) but now writes moved fields to the facility. See [[rbac-role-model]].
