---
name: certificate-empty-state-export-gate-regression
description: CertificateCardList export-controls gating fix (certificates.length > 0) is missing on feat/approved-design-certificates-and-audit; branch was cut before it landed
metadata:
  type: project
---

`src/components/dashboard/training/CertificateCardList.tsx`'s export-controls
gate is `{showExport && certificates.length > 0 && (…)}` — but that
`certificates.length > 0` clause only exists on commit `5671a4ed`
("fix(certificates): hide export controls when there are no certificates"),
which lives on branch `fix/ui-polish-empty-states-and-banners` only. It was
never merged into `dev`.

Commit `7377c4f2` (the illustrated-empty-state feature, branch
`feat/approved-design-certificates-and-audit`) was cut from the same parent
(`d11425a6`) as `5671a4ed`, as a sibling — not a descendant — so that branch's
`CertificateCardList.tsx` has the plain `{showExport && (…)}` with no
length check. A learner with zero certificates on this branch sees the
date-range filter and Export button with nothing to export (QA #6
regressed).

**Why**: two fixes landed on unmerged sibling branches off the same base
commit; neither branch's author had the other's fix in their tree. `dev`
itself also lacks `5671a4ed` as of 2026-08-28.

**How to apply**: before trusting any "the gating still holds" claim about
this component, check `git log --oneline -- src/components/dashboard/training/CertificateCardList.tsx`
on the branch under test for `5671a4ed` (or its content). A regression test
(`src/components/dashboard/training/CertificateCardList.test.tsx`, "hides the
date-range filter and Export button when there are no certificates") pins
the required behavior and will fail red until the branches converge — that
failure is a product defect, not a test bug.
