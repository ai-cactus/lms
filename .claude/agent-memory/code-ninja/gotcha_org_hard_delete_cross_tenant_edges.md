---
name: gotcha-org-hard-delete-cross-tenant-edges
description: Deleting one org's rows can silently cascade into OTHER orgs' data (Document.organizationUser, course-keyed cascades); PR C refuses on these instead
metadata:
  type: project
---

The org graph has edges that cross tenants: `Document.organizationUser` (Cascade) deletes another org's document when this org's uploader membership goes; `CourseAssignment`/`OrgCourseOffering`/`InviteCourseAssignment.course` (Cascade) delete other orgs' rows on this org's courses; `Course.creator`, `Enrollment.course`, `Certificate.course`, `QuizAttempt.quiz`, `CourseVersion.documentVersion` (Restrict) block. `hardDeleteOrganization` counts all of these (`countCrossOrganizationUsage`) and refuses rather than reach into another tenant.

**Why:** the plan only listed enrollments/offerings/certificates/assignments; a "nothing outside the org changes" success criterion needed the rest (2026-10-13, PR C).

**How to apply:** any new delete keyed on an org or membership must check rows OUTSIDE the org that point in (`organizationId: { not }` patterns), and client-writable storage columns (`FacilityDocument.url`, `Facility.complianceDocumentUrl`) need a prefix-ownership check before an exact-URI delete (see SEC-20). Related: [[gotcha-no-dmmf-ondelete-at-runtime]], [[gotcha_document_identity_is_org_wide]].
