---
name: tier3-dynamic-import-tests
description: Test techniques for Tier 3 5.2 dynamic-import lazy-loading (AuthHeroSlider, staff-csv xlsx, certificate-export jspdf/html-to-image) — next/image SSR limitation, Suspense-fallback proof technique, CertificateModal viewport-overlap bug
metadata:
  type: project
---

Context: perf/tier3-app-optimization branch, item 5.2 — lazy-loaded framer-motion
(AuthHeroSlider), xlsx (staff-csv.ts), and jspdf/html-to-image (certificate-export.ts)
off hot paths via `next/dynamic`/`await import()`.

**next/image cannot be rendered via plain `react-dom/server` `renderToString`** outside
Next's own app-render pipeline — throws "Element type is invalid: expected a string ...
but got: object" even in isolation (verified directly, not assumed). This is why every
test in this repo touching a component with `next/image` mocks it; there is no way to
test real Next SSR output of an Image-containing tree from vitest.

**Technique for proving a `next/dynamic({ ssr: false, loading })` fallback is correct**:
you don't need real SSR. Render with `@testing-library/react`'s `render()` (client,
jsdom) with `next/image` mocked to a plain `<img>`. On first synchronous render, the
`React.lazy` internals haven't resolved the dynamic import promise yet, so React's
Suspense boundary shows the `loading` fallback — this is the *same* fallback content
Next's real production SSR renders when it hits `BailoutToCSRError` (confirmed by
reading `node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js` and
`dynamic-bailout-to-csr.js` — Next's own app-render has special handling for that error
type). Assert on the fallback's content immediately after `render()`, then
`await waitFor(...)` for the hydrated/interactive content to prove the swap-over also
works. This was the technique used for `AuthHeroSlider.test.tsx`.

**Testing a function that changed from `import * as X` to `await import('x')` inside its
body**: don't just re-test the pure logic that consumes its output (that doesn't exercise
the changed line) — write a direct test of the async wrapper function itself using the
REAL package (no mock needed if the package is fast/pure, e.g. `xlsx`). Found this gap in
`staff-csv.ts`: 40 pre-existing tests covered `extractStaffEmailsFromRows`/
`extractManagerInvitesFromRows` (pure, untouched by the diff) but zero tests covered
`readStaffSpreadsheetRows` itself (the actual dynamic-import site). Corrupting an xlsx
buffer to make `XLSX.read` throw for real requires a fake ZIP header + garbage bytes
(`'PK\x03\x04' + garbage`) — arbitrary random bytes are NOT rejected by SheetJS, it just
parses them as CSV-ish text.

**Testing a dynamic-import pair (`html-to-image` + `jspdf`) that needs a real
`<canvas>`**: `toPng` cannot run in jsdom (no canvas). Mock both packages at the module
level (`vi.mock('html-to-image', ...)`, `vi.mock('jspdf', ...)`) and assert call
arguments/error-propagation contract in vitest; cover the real dynamic-import + real
canvas rendering + real download only in a Playwright e2e spec (real Chromium has a real
canvas).

**Found product bug (pre-existing, NOT caused by Tier 3 5.2, not fixed by bug-hunter)**:
`CertificateModal` (`src/components/dashboard/training/CertificateModal.tsx`) renders its
certificate preview card centered via `items-center justify-center` inside a `py-20`
dialog. At the project's standard e2e/default desktop viewport (1280x720), the scaled
card (up to ~671px tall) exceeds the ~560px available height, so it renders taller than
its box and gets pushed up over the fixed top-right "Export PDF"/Close button bar —
making those buttons unclickable (Playwright reports "subtree intercepts pointer events"
on click; reproduced with a screenshot showing the white card visually overlapping the
buttons). `tests/e2e/certificate-export.spec.ts` works around this with
`test.use({ viewport: { width: 1280, height: 1100 } })` — this is a **test
accommodation, not a fix**; a real fix (e.g. cap the card's rendered height, or move the
button bar outside the centered flex flow) should be routed through `code-ninja`.

New test files: `src/app/(auth)/components/AuthHeroSlider.test.tsx`,
`src/app/(auth)/components/AuthHeroSliderContent.test.tsx`,
`src/lib/certificate-export.test.ts` (new module, no prior tests existed),
`tests/e2e/certificate-export.spec.ts` (new spec — seeds org/facility/worker/course/
enrollment/certificate/subscription directly via raw SQL to skip the MinIO/GCS-dependent
`issueCertificate()` flow entirely, since `exportCertificatePdf` re-rasterizes from the
DOM on every click regardless of `pdfStoragePath`). Extended: `src/lib/staff-csv.test.ts`
(+5 tests for `readStaffSpreadsheetRows`), `tests/e2e/auth.spec.ts` (+1 hero-image-visible
test), `tests/e2e/staff-invite-flow.spec.ts` (+1 CSV-upload-through-dynamic-xlsx-import
test, added to the existing spec rather than a new file — same flow, per the "update the
existing spec for a flow" convention).

**Reused the durable subscriptions-seeding rule** from
[[qa-still-open-2026-07-19-regression-tests]] for the new certificate-export.spec.ts's
raw-seeded org+worker — omitting it makes `WorkerLayout` render
`WorkerBillingBlockedScreen` instead of the real `/worker/certificates` page.
