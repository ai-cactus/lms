---
name: document-hub-patterns
description: Document Hub upload/PHI-scan/viewer/rename/delete flow on production, fixture-generation fallback, and known reliability gaps
metadata:
  type: reference
---

**Generating PDF/DOCX test fixtures when Python tooling is unavailable:** this environment had no `pip`/`pip3`, and Python's `docx`/`reportlab`/`fpdf` modules were not installed, so `python-docx`/`reportlab` cannot be assumed available. **Working fallback:** Node/npm was available — `npm install pdfkit docx` (in a scratchpad dir, not the repo) produces genuinely valid PDF/DOCX files quickly via small one-off scripts. Verify output with `file <path>` (expect "PDF document..." / "Microsoft Word 2007+"). Don't assume `libreoffice`/`soffice`/`pandoc` exist either — check first.

**Document Hub location:** `/dashboard/documents` (sidebar "Documents"). Empty state: "No documents found. Upload a document to get started."

**Upload flow (2026-07-01, production):**
1. "Upload New" button opens a dialog with "Choose File" (native file chooser via `playwright-cli upload`), copy "Drag & drop or Click to Select (PDF, DOCX - Max 10MB)", a required checkbox **"I verify this document contains no Personal Health Information (PHI)."** (self-attestation, NOT itself a scanner), and an "Upload" button that is **disabled** until both a file is selected AND the checkbox is checked (confirmed AC: compliance confirmation required before upload — this part works correctly and reliably).
2. Selecting a non-PDF/DOCX file (e.g. `.txt`) triggers an immediate **client-side** rejection: inline alert "Only PDF and DOCX files are allowed." — Upload stays disabled. No network call needed to reject; format gating works correctly.
3. Clicking "Upload" closes the modal immediately with **no toast, no confirmation, no error** regardless of outcome — this is a genuine UX gap, not a tooling limitation.

**MAJOR FINDING — document-list refresh after upload is unreliable and PHI-scan feedback is completely absent:** After a successful-looking upload (modal closes, network POST returns 200), the new document does NOT reliably/promptly appear in the `/dashboard/documents` list:
- Some uploads appeared near-instantly; one clean-file upload took several minutes on its first attempt (but was instant on a retry of the identical file); a PHI-laden test PDF (`phi-test-policy.pdf`, fake SSN/DOB/MRN/patient name) **never appeared even after 15+ minutes** of polling.
- No error/warning/quarantine/"PHI detected" status is EVER shown anywhere in the UI, regardless of whether the upload eventually succeeds, is slow, or (in the PHI case) apparently never completes.
- **Cannot conclusively distinguish, via black-box testing, whether PHI content is being silently server-side-rejected (a working control with zero transparency) vs. a generic reliability bug** — both hypotheses are consistent with what was observed. Filed as ISSUE 1 (reliability) and ISSUE 2 (PHI transparency) in `qa-reports/phase-3-document-hub.md`. If revisiting this area, check server/AI-pipeline logs for the specific upload timestamp to get a definitive answer — black-box retesting alone won't resolve it.
- Practical tip for future runs: don't conclude "upload failed" from an immediate empty-list check — poll for several minutes before drawing conclusions, but also don't assume a long wait guarantees eventual success (the PHI file never appeared even after 15 min).

**Document detail/viewer page:** clicking a document row navigates to `/dashboard/documents/<uuid>` — a dedicated reader that renders the actual PDF text content in a scrollable pane with page nav ("Page X of Y"), zoom controls, a **signed, time-limited GCS download link** (`storage.googleapis.com/theraptly-lms-storage/...` with `X-Goog-*` signature params, ~15 min expiry), and a "Metadata" panel with its own "Status" field (e.g. "Uploaded") — this is DIFFERENT from and inconsistent with the list page's "Status" column, which always reads "Not Started" (likely course-generation status, not upload/scan status) — a minor but real terminology confusion between the two screens.

**Rename/Delete:** via a row "Row actions" menu → "View" / "Edit Name" / "Delete". Rename opens a simple dialog (textbox pre-filled with current name + Save/Cancel) and persists immediately + across reload. Delete triggers a **native browser `confirm()` dialog** (not an in-app styled modal, inconsistent with Rename's custom dialog) with copy "Delete "<name>"? This will permanently remove the file from storage and cannot be undone." — handle with `playwright-cli dialog-accept`/`dialog-dismiss`. Deletion is immediate and persists across reload.

**Cosmetic bug:** file size in the list always displays as "0.0 MB" for small (KB-range) test files due to one-decimal MB rounding; the detail page shows correct precision (e.g. "Size: 2.1 KB").

See also [[production-env-access]] for login/onboarding, and note the CLAUDE.md-documented "AI Pipeline (v4.6): Multi-stage orchestration for content generation and PHI scanning" — this is presumably the async backend process responsible for the delayed/absent list updates described above.
