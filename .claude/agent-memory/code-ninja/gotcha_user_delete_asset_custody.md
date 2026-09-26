---
name: gotcha-user-delete-asset-custody
description: Deleting a user reassigns authored courses/documents to a surviving member — the Course Restrict vs Document Cascade asymmetry is why, and what still vanishes
metadata:
  type: project
---

Hard-deleting a user (`deleteUserWithRelations`, `src/app/actions/system-admin.ts`) must never
destroy a course or a document. Both are ORGANIZATION assets (Q25); `Course.createdByOrgUserId` and
`Document.organizationUserId` record authorship only. The delete now REASSIGNS both to the most
senior surviving member of the same org (`findAssetCustodian`: active first, then owner → admin →
hr → clinical_director → supervisor → finance → anyone, then oldest membership), and REFUSES the
delete when no member survives.

**Why:** the two FKs fail in opposite directions and neither is safe on its own.
`Course.creator` is `onDelete: Restrict`, so the membership simply cannot be deleted while it
authors a course — which is why the old code hard-deleted the courses to get the delete through,
taking Theraptly's `isGlobal` courses and every other tenant's enrollments with them (BUG-09).
`Document.organizationUser` is `onDelete: Cascade`, so doing nothing silently destroys retained
documents instead. Archiving does not help either: it satisfies no FK, and losing an author is not
a reason to withdraw the org's training. Reassignment is the only move that satisfies both.

**How to apply:** any future membership-delete path (`removeStaff` only deactivates today, and
self-service account deletion is deferred) must reuse the same custody step before it deletes.
Two things still vanish with the identity and are NOT recoverable — call them out rather than
implying otherwise: the person's own enrollments, quiz attempts and certificates (Cascade off
`OrganizationUser`), and the `approvedByOrgUserId` / `archivedByOrgUserId` attribution on courses
and documents they signed off (SetNull). Related: [[gotcha_authorship_is_not_ownership]],
[[project_archive_filter_and_raw_prisma]], [[gotcha_document_identity_is_org_wide]].
