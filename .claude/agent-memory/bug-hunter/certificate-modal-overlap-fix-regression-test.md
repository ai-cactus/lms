---
name: certificate-modal-overlap-fix-regression-test
description: tests/e2e/certificate-export.spec.ts now exists (fix/certificate-modal-button-overlap branch) covering the real CertificateModal.tsx fix at the standard 1280x720 viewport — supersedes the old "workaround viewport, unfixed bug" note in tier3-dynamic-import-tests
metadata:
  type: project
---

[[tier3-dynamic-import-tests]] documented `CertificateModal` overlapping its own
"Export PDF"/Close buttons at the standard 1280x720 e2e viewport as an unfixed
product bug, worked around in a *different branch's* `certificate-export.spec.ts`
with `test.use({ viewport: { width: 1280, height: 1100 } })`. That workaround spec
was never on `fix/certificate-modal-button-overlap` (or `dev`) — don't assume it
exists; check the branch first.

The real fix landed on `fix/certificate-modal-button-overlap`: the preview's scale
is now bounded by both width AND height (`Math.min(availWidth / CERT_WIDTH,
availHeight / CERT_HEIGHT)`), and the action bar got `z-10`. Added
`tests/e2e/certificate-export.spec.ts` at the **real** default 1280x720 viewport
(no workaround), asserting a real `.click()` on both buttons succeeds (not just
visibility) plus a real `download` event for Export PDF, then closes.

**Verified the test actually catches the regression**, not just passes trivially:
`git stash push -- src/components/.../CertificateModal.tsx` to revert to the
pre-fix version, reran — it failed for the right reason (`page.waitForEvent:
download` timeout, because `exportButton.click()` landed on an element the
overlapping preview card was covering — never fired). A screenshot at failure
time visually confirms the white certificate card overlapping "...port PDF" and
the close X, exactly matching the bug description. `git stash pop` restored the
fix; reran once more — passed clean (10.2s). This stash-revert-confirm technique
is the same one used in [[audit-fx-regression-patterns]].

**New fixture added to `prisma/seed.ts`**: `cara.certificate@test.com`
(`CERTIFICATE_WORKER_ID`), a `completed` enrollment (`ENROLLMENT_CERTIFICATE_ID`)
in the shared 'E2E Compliance Training' course, and a `Certificate` row
(`CERTIFICATE_ID`) with a dummy `pdfStoragePath` — created directly via
`prisma.certificate.upsert`, NOT via `issueCertificate()`. This was a deliberate
choice, not a shortcut: `getCertificateDetails()` (the modal's data source) and
`exportCertificatePdf()` (the Export PDF handler) are **both** driven from the DB
row + live DOM, never from `pdfStoragePath` itself — html-to-image rasterizes the
on-screen `CertificateDocument` node client-side and jsPDF downloads it directly,
no server round-trip. So unlike the other certificate/attestation e2e coverage
(`quiz-retake-attestation.spec.ts`), **this fixture needs no MinIO/GCS backend at
all** — first certificate fixture in this repo that's fully storage-independent.

Local run recipe used (dev-mode, not full prod-build CI parity, since this spec
doesn't touch anything build-mode-sensitive): full env block per
[[e2e-local-auth-url-env-trap]] plus `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_HOST=localhost`/
`SMTP_PORT=1025` — omitting SMTP entirely makes `src/instrumentation.ts`'s
`validateEnv()` throw at server boot ("email transport: set SMTP_USER +
SMTP_PASSWORD...") and the whole webServer fails to start, not just mail-related
tests. `DATABASE_URL` must point at `lms_e2e` (5433, password `0951` per
[[e2e-local-verification-runbook]] in user memory) — reseed after switching the
target DB.
