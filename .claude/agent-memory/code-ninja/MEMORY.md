# Memory Index

- [Dashboard metrics glossary](dashboard-metrics-glossary.md) — multi_facility_notes.pdf is canonical for dashboard metric names/formulas; two open product decisions from the alignment pass
- [Supervisor own-facility edit](supervisor_own_facility_edit.md) — PROF-002 deliberately lets supervisors edit their own facility despite the read-only RBAC ruling; don't "fix" it back
- [Figma STAFF section](reference_figma_staff_section.md) — frame→page map; roster's 5 columns don't fit at lg, % widths from xl (measure 1280 AND 1440)
- [Local UI verification](project_local_ui_verification.md) — Playwright recipe for the dev app; port 3005 may be a decoy build, newPage() ignores viewport
- [Course wizard 7→9 steps](project_course-wizard-9-step.md) — steps 1-7 built (Phase 6 = per-module generation); steps 6+7 share GenerationController by design
- [Wizard PHI attestation](project_course-wizard-phi-attestation.md) — step 2's attestation checkbox isn't in the mock but is required: uploadDocument rejects FormData without phiAttested
- [Document Hub scope](project_document-hub-scope.md) — rename dropped from the UI (action kept); list hover card cut, but the viewer's thumbnail rail was ruled back IN
- [Step-7 review honest gaps](project_wizard-step7-review-honest-gaps.md) — no citation chips, "Key Points" not "Tip!", Edit button inert: deliberate, don't invent the missing data
- [Assign-action authorization split](gotcha_assignment_action_authorization_split.md) — enrollUsers gates on creator identity, assignCourseToUsers on org ownership; wrong pick → "Course not found"
