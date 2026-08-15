---
name: course-wizard-phi-attestation
description: The wizard's step-2 upload shows a PHI attestation checkbox that is NOT in the Figma mock — uploadDocument rejects any FormData without phiAttested='true'
metadata:
  type: project
---

Step 2 of the course wizard ("Create Course Modules") renders a PHI attestation checkbox above the upload dropzone even though the Figma frames (LMS156/153/154/155/159) show none. Added 2026-08-14 in Phase 3 of the design alignment.

**Why:** `uploadDocument` / `uploadDocuments` in `src/app/actions/documents.ts` fail fast on `formData.get('phiAttested') !== 'true'` (control #11 — an authoritative server-side gate, deliberately separate from the AI PHI scan). The old wizard upload path never sent that field, so **every wizard upload had been failing** with "You must confirm this document contains no PHI" before Phase 3. Hard-coding `'true'` from client code would have faked a user attestation, so the checkbox surfaces the control instead of bypassing it.

**How to apply:** don't remove the checkbox for pixel-fidelity with the mock without also changing the server contract, and don't add any new upload surface that sends `phiAttested: 'true'` unconditionally. Related: the PHI *scan* result is a hard block — a flagged document is never stored, so the UI clears the upload slot along with showing the warning banner (a deliberate divergence from the mock, which still shows the file attached). See [[course-wizard-9-step]].
