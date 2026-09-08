---
name: gotcha-document-identity-is-org-wide
description: getDocuments() is org-wide, so resolving an upload back by filename attaches a colleague's document; uploadDocument now returns the stored Document record instead.
metadata:
  type: project
---

Never resolve a just-uploaded document's identity by matching `filename` against
`getDocuments()`. That action returns EVERY document in the organization
(`where: { organizationUser: { organizationId } }`, `orderBy: updatedAt desc`),
so an identically-named file belonging to a colleague can win the match — and
the course wizard then generated the course from their material.

`uploadDocument` / `processSingleUpload` (`src/app/actions/documents.ts`) return
`document: { id, filename, mimeType, size }` on success — one record, so the id
and the metadata rendered next to it can never describe different rows. Consume
that; if it is absent, fail loudly (the user retries) rather than guessing.

Note the asymmetry: the WRITE path is correctly scoped — its existing-document
lookup is `{ organizationUserId, filename }`, i.e. the uploader's own file. It
was only the read-back that crossed users.

**Why:** shipped bug, reproduced 2/2 by QA on staging 2026-09-08; fixed on
`fix/remove-duplicate-and-wizard-doc-id`.

**How to apply:** whenever a server action stores something and the client needs
to reference it afterwards, return the identifier. Any "find it again by name"
step over an org-scoped list is a cross-user leak waiting to happen — see
[[courses-and-documents-are-global]] for why these lists are org-wide at all.
