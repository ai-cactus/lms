---
name: gotcha-certificate-export-render-pipeline
description: Certificate PDFs are rasterised from a live CertificateDocument node — the constraints that keeps (off-screen not hidden, jsPDF's blank first page, card list lacks the name)
metadata:
  type: project
---

Both certificate exports (single, from `CertificateModal`; bulk "Export All", from
`CertificateCardList`) rasterise a **live DOM node** — the real `CertificateDocument` —
via `html-to-image` and drop the PNG into a jsPDF page. There is deliberately no second
renderer, so anything that breaks the capture silently produces a wrong or blank PDF.

**Why:** the design must not drift between preview and download, and the artwork is
fixed-size (`CERT_WIDTH`/`CERT_HEIGHT`, A4 landscape @96dpi) precisely so the capture is
deterministic.

**How to apply — the four traps:**
- Off-screen nodes must be *positioned* out of view (`fixed -left-[10000px]`), never
  `display:none` / `visibility:hidden` / `opacity:0` — a collapsed node captures blank.
- Never put a transform/scale on the captured node. The responsive preview wrapper scales
  an *ancestor*; the exporter also forces `transform:none` on the node it captures.
- jsPDF opens with one page already. The first certificate must fill it and only pages
  2..n call `addPage('a4','landscape')`, or page 1 is blank.
- `CertificateCardList`'s own row type is `{id, enrollmentId, course.title, issuedAt}` —
  it has **no student name and no organization name**. Any export must fetch each record
  through `getCertificateDetails` (sequentially; see the commit rationale) to fill them.

`src/lib/certificate-export.ts` owns the rasteriser, the `document.fonts.ready` wait, the
filename sanitiser, the dynamic `import()` of jspdf/html-to-image, and
`formatCertificateIssueDate`. Add to that module rather than inlining PDF logic in a
component. Its unit test mocks both libraries and pins ordering (a failed capture must not
have constructed a jsPDF), so reordering the single export breaks a test that looks
unrelated.
