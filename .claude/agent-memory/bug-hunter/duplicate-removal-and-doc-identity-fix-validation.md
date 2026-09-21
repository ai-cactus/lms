---
name: duplicate-removal-and-doc-identity-fix-validation
description: Validated fix/remove-duplicate-and-wizard-doc-id (Duplicate feature removal + wizard cross-user document attach bug) — regression-test technique (live uploads are e2e-testable via the local-regex PHI path)
metadata:
  type: project
---

Validated on 2026-09-08 (branch `fix/remove-duplicate-and-wizard-doc-id`, commits `b952373`+`7b42fc1` on top of `dev`@a0b253a). Two independent changes: (1) Duplicate course feature removed entirely (clean — no orphaned refs anywhere, Delete/`isOrgAuthored` coverage in `CoursesListClient.test.tsx` and `publish-on-assign.test.ts` both untouched and green), (2) `processSingleUpload` (`src/app/actions/documents.ts`) now returns the resolved `document: {id, filename, mimeType, size}` instead of the wizard re-deriving it via org-wide `getDocuments()` + filename match (which could attach a colleague's identically-named document).

**Regression-test technique worth reusing**: `code-ninja`'s tests covered the new-document branch and the "no document → fail loudly" UI branch, but had ZERO coverage of the *existing-document* branch (`tx.document.findFirst` returns non-null on a same-filename re-upload — reuses the `Document` row, only creates a new `DocumentVersion`). That branch is exactly where the "metadata must come from the stored row, not the just-uploaded `File`" invariant lives. I added 3 tests to `src/app/actions/documents.test.ts` (new describe block "returned document identity"); the key one deliberately sets the existing row's stored `size`/`mimeType` to DIFFERENT values than the incoming `File`'s — a regression that swapped back to `file.size`/`file.type` would fail on the metadata mismatch, not just a missing id. Also pinned that the existing-doc lookup is scoped to `organizationUserId` (this uploader), not org-wide — that scope is what makes cross-user attachment structurally impossible now (vs. the old bug's org-wide `getDocuments()` scope).

**E2E:** live uploads ARE testable via `phiScanner.ts`'s deterministic local-regex path (no Vertex needed) — see [[course-wizard-single-doc-pr3a-test-patterns]].

**Why this matters going forward**: any future change to `processSingleUpload`'s document-resolution logic should keep both branches (new + existing) covered with this same "stored row vs. File" divergence trick, otherwise a regression back to org-wide filename matching (or to trusting `file.*` over the stored row) would slip through silently.
