---
name: gotcha-storage-uri-ownership-is-key-prefix
description: Storage providers ignore a URI's bucket — only the key selects an object, so validate client-supplied storage URIs by key prefix via src/lib/onboarding/document-storage.ts
metadata:
  type: project
---

`gcs-provider.ts` and `minio-provider.ts` take only `key` from `parseStorageUri` and always act on their own configured bucket (`GCP_BUCKET_NAME` / `MINIO_BUCKET`). The bucket segment of a stored URI never selects an object, so comparing it adds no protection — ownership is decided by the key prefix alone.

**Why:** SEC-20 (#735, 2026-10-17) — `completeOnboarding` stored client-supplied `FacilityDocument.url` values that the profile page then signed, so any key the client could name became downloadable.

**How to apply:** before storing, signing or deleting a storage URI that came from the client, check its key with the shared rule — `isOwnOnboardingStorageKey` / `isOwnOnboardingDocumentUri` in `src/lib/onboarding/document-storage.ts` (strictly inside `onboarding/{userId}/`, no `.`/`..` segments, unparseable = not owned). Don't hand-roll a `startsWith`: the trailing slash and dot-segment rules are what make it safe. Prefer not accepting the URI from the client at all — `Facility.complianceDocumentUrl` is written only by `uploadComplianceDocument` for that reason. Related: [[gotcha-org-hard-delete-cross-tenant-edges]].
