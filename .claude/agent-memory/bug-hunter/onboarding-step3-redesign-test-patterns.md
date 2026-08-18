---
name: onboarding-step3-redesign-test-patterns
description: Test patterns for the step3 business-type Figma redesign (Select + inline checkbox grids with "Other (specify)"); OrganizationForm/FacilityForm read-view assertions after the shared-constants refactor
metadata:
  type: project
---

Covers testing `src/app/onboarding/step3/page.tsx` (Figma redesign: 9-option primary Select,
inline 2-col checkbox grids for Additional Business Type + Program Services, each with an
"Other (specify)" toggle), `src/lib/onboarding/step3-selection.ts` (pure resolve/hydrate helpers),
and the read-only `OrganizationForm`/`FacilityForm` panels that consume the same shared
`src/lib/constants/onboarding-options.ts`.

**Playwright selector gotchas specific to this UI:**
- Both the "Additional Business Type" and "Program Services" checkbox grids always render their
  own "Other (specify)" **button** (not conditionally) — `getByRole('button', { name: /other/i
  })` without `.first()`/`.last()` throws a strict-mode violation because both are present
  simultaneously. DOM order = Additional Business Type section before Program Services.
- Once more than one "Other" text box is open at once (e.g. primary + additional both set to
  Other), `getByPlaceholder('Please specify')` matches multiple inputs — index by DOM/section
  order (primary, then additional, then services) rather than adding a unique placeholder.
- Primary Business Type is the ONLY combobox on this page since the popover-Select for Additional
  Business Type was removed — `getByRole('combobox')` is now unambiguous there.

**Real product bug found and fixed in this pass:** Back-navigating from step4 to step3 restored
the checkbox-based fields (additionalBusinessTypes, services, incl. "Other" text) correctly via
the new mount-time `reset()` from the localStorage draft, but the **primary Select field** stayed
blank and — critically — was genuinely empty in RHF state too (confirmed by clicking Next without
reselecting: got a "Primary Business Type is required" validation error, not just a stale visual).
Root cause (per code-ninja's fix): Radix renders a hidden native `<select>` when a Select sits
inside a `<form>`, and echoes a change event back through `onValueChange` reporting `""` until the
matching `<option>` registers — wiping the value `reset()` had just set programmatically. Fixed by
guarding `onValueChange` against an empty-string echo. Diagnostic technique that isolated this
cleanly: read `localStorage.getItem('onboarding_data')` via `page.evaluate` to confirm the draft
was written correctly, then click Next *without* reselecting anything post-Back to check whether
RHF's own required-validation fires — this distinguishes "data lost" from "only the visual is
stale" much faster than inspecting the accessibility tree.

**`OrganizationForm`/`FacilityForm` read-view fallout from the shared-constants refactor:**
`OrganizationForm.tsx` replaced its two business-type `ReadOnlySelect`s with disabled/readOnly
`<Input>`s (so labels resolve via `getOptionLabel` + a `LEGACY_PRIMARY_BUSINESS_TYPE_LABELS`
fallback map for old ids like `'clinic'`, or raw passthrough for old `additionalBusinessTypes`
ids with no legacy map, e.g. `'non-profit'` displays verbatim, not title-cased). This dropped the
combobox count on that page from 3 to 1 (HIPAA only) — the pre-existing test asserting
`toHaveLength(3)` and `getByText('Clinic')`/`getByText('Non-Profit')` broke; fixed by asserting
`getByDisplayValue(...)` instead and adding dedicated legacy-fallback + raw-passthrough tests.
`FacilityForm.tsx`'s `PROGRAM_SERVICES` import from the shared constant is byte-identical to its
old inline array (same 7 ids/labels, `other` filtered out of the checkbox grid) so its existing
test suite needed no changes — only an added test for the new "Other: {value}" unknown-id row.

See also [[full-e2e-suite-serial-flakiness]] for unrelated flakiness (course/quiz specs) surfaced
by the same full-suite run this feature was verified against.
