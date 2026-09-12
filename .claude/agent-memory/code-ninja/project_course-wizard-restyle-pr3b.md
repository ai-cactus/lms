---
name: course-wizard-restyle-pr3b
description: PR-3b restyled the 7 wizard screens to Figma; records the three deliberate design/code divergences and the cmdk dependency it added
metadata:
  type: project
---

PR-3b (branch `feature/course-wizard-restyle`) restyled all seven course-wizard
screens to the vetted Figma ADMINS section. Three things in the shipped UI are
**deliberately not what the frames show** — do not "fix" them back:

1. **Step 2 keeps the PHI attestation checkbox.** The frames show a bare dropzone.
   `uploadDocument` rejects FormData without `phiAttested`, so removing it breaks
   upload. See [[project_course-wizard-phi-attestation]].
2. **Step 4 keeps the "Quality Notice" advisory** under Number of Questions
   (now the shared `Alert` primitive). Not in the frame; it is real guidance and
   `Step4Quiz.test.tsx` asserts it.
3. **Step 5's rail keeps the "Sources" tab** beside "Table of Content". The frame
   shows only the ToC heading, but Sources carries the source document + excerpt
   and `WizardReviewArticle.test.tsx` drives it.

Also: **the quality-warning toast in the frames (`15738:289815`) is NOT the F-051
gate.** It reads like `ReviewWarningsModal`'s copy, but PR-3b only converted the
*inline* warnings (content-shortfall + `generatedContent.warning` in
`GenerationController`) into the floating toast. `ReviewWarningsModal` stays a
blocking modal — turning it into a dismissible toast is a behaviour change.

**Why:** each of these looks like an oversight in the restyle and invites a
"finish the job" edit that would break upload, drop real guidance, or open a
compliance gate.

**How to apply:** when the wizard is compared against Figma again (PR-4, qa-mafia
re-validation, a design review), point at this note rather than re-litigating.

**Dependency added:** `cmdk@^1.1.1`, for `src/components/ui/command.tsx` — the
searchable category combobox on step 1. It is the only runtime dependency the PR
adds; its Radix deps resolved from the existing tree (18-line lockfile diff) and
`npm audit` stays at 0 high. See [[npm_audit_gate]] and
[[gotcha_npm_install_allow_remote]].
