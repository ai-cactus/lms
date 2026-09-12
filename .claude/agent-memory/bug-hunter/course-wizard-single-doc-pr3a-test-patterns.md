---
name: course-wizard-single-doc-pr3a-test-patterns
description: PR-3a (course-creation-flow-redesign) test patterns — deterministic local-regex PHI bypass for live uploads, pdfkit/pdf-parse version incompatibility, a pre-existing false-positive assertion found in quiz-ai.test.ts, MIN_SCAN_LENGTH's dual role
metadata:
  type: project
---

Context: PR-3a replaced the wizard's multi-module builder (Step2Modules) with a
single-document upload step (Step2Upload, D1) and added `regenerateQuiz` +
quiz-review regenerate UI. Full test suite: `Step2Upload.test.tsx` (new),
`wizardSteps.test.ts` (extended with `displayStepNumber`), `wizard-draft-
migration.test.ts` (new, the `_v3`->`_v4` draft payload bump),
`quiz-ai.test.ts` (extended with `regenerateQuiz` + a resolveQuizContext
parity test), `Step6QuizReview.test.tsx` (extended with Regenerate Quiz),
plus `tests/e2e/course-creation.spec.ts` (new) and
`tests/e2e/course-creation-phi-rejection.spec.ts` (new). Deleted
`tests/e2e/course-wizard-module-builder.spec.ts` (fully obsolete — drove the
deleted module builder) and updated the ENG-024 test in `course.spec.ts` to
the new single-document step.

**Local-regex PHI bypass makes real, live document uploads testable without
Vertex.** `phiScanner.ts`'s `scanText` runs a deterministic, zero-network local
pre-pass (`scanForPii`) on EVERY input before any AI call. A HIGH-confidence
structural identifier — canonical-dashed SSN (`123-45-6789`), email, or phone
— short-circuits with `hasPHI: true, decidedBy: 'local_regex'` with ZERO Vertex
transmission, regardless of `GOOGLE_PROJECT_ID`. This is genuinely reachable
live in e2e even though this repo has no real Vertex credentials anywhere
(local `.env` has `GOOGLE_PROJECT_ID` commented out; `.env.e2e` and even CI's
own `ci.yml` set `GOOGLE_PROJECT_ID=ci-dummy-project-not-real`). Confirmed live:
uploading a real `.docx` containing an SSN blocks via `local_regex` with no
Vertex log lines at all.
**Why:** `documents.spec.ts`'s own module docstring claims live document
upload is unconditionally out of scope ("PHI gate always calls a real Vertex
AI scan that always fails closed") — true for CLEAN content, but not for
content carrying a high-confidence structural identifier.
**How to apply:** for any future PHI-hard-block e2e test, use a real upload
with SSN/email/phone-pattern text rather than a deep-link bypass — it is
deterministic and needs no Vertex. For a CLEAN-verdict live assertion, keep
the text under `MIN_SCAN_LENGTH` (50 chars) so it resolves via
`skipped_short` instead of falling through to the real (uncredentialed,
fail-closed) contextual AI scan — confirmed live: a 70-char clean doc failed
closed with "Could not load the default credentials," a <30-char one passed
clean immediately.

**`MIN_SCAN_LENGTH` (50 chars) is shared by two unrelated gates on the same
text.** `phiScanner.ts`'s scan-short-circuit AND the deprecated v1
`analyzeStoredDocument` ("Document content is empty or too short," 50-char
floor in `course-ai.ts`) both key off ~50 characters. A wizard upload text
short enough to dodge the live AI PHI scan will also trip the (non-blocking,
already-known-to-fail-open) legacy analysis call on the Upload->Details
transition. Harmless — `CourseWizard.tsx`'s `finally` advances regardless —
but shows up as an ERROR log line in the webServer output; expected, not a
regression.

**pdfkit-generated PDFs do not parse with this repo's pdf-parse@1.1.1
(bundles pdf.js v1.10.100).** Tried both default and `{compress:false,
pdfVersion:'1.3'}` pdfkit output — both threw `FormatError: bad XRef entry` /
`Invalid number` inside pdf-parse's vendored pdf.js. Use the `docx` package
(already a real dependency, not just a devDependency) + `mammoth` instead for
any test needing a real, parseable uploaded document with controlled text —
confirmed round-trips cleanly. Also note: requiring `pdf-parse` directly as a
script's top-level import triggers its internal debug harness (`ERR: ENOENT
./test/data/05-versions-space.pdf`) unless required from a non-entry module
(the app never has this problem — it's only a standalone-repro-script trap).

**Pre-existing false-positive test found (not touched, out of scope for
PR-3a): `quiz-ai.test.ts` > "delimits client-supplied context too."** With a
~55-char `options.context` and no `courseId`, `assertNoPhi` triggers BEFORE
generation — `scanChunkWithAI` calls the shared `mockCallVertexAI`, gets back
the single-question fixture (no `hasPHI` field), fails closed
("AI response had unexpected structure" -> `PhiBlockedError`), and
`generateSingleQuestion` returns `{success:false, error: "We could not
verify..."}` WITHOUT ever calling its own question-generation prompt. The
test's assertions (`prompt.indexOf('<<<BEGIN UNTRUSTED COURSE CONTENT>>>')`
returns -1, and `injected > -1` is trivially true) pass vacuously — it is not
actually exercising the prompt-injection delimiting it claims to. Confirmed
by a forced-failure diagnostic showing `mockCallVertexAI` was called exactly
once, with the PHI-scan prompt, not the question-generation prompt. Left
unmodified per bug-hunter scope (pre-existing, unrelated to this PR's diff) —
flag to `code-ninja`/user if ever asked to harden this suite.

**`regenerateQuiz`'s rate limit is a separate key/budget from
`generateSingleQuestion`'s** (`quiz-regenerate:{userId}` 5/600s vs.
`quiz-question:{userId}` 30/300s) — tested by asserting the literal key
string passed to the shared `checkRateLimit` mock, and by confirming a
regenerate-limit hit doesn't block a subsequent `generateSingleQuestion`
call in the same test.

**`resolveQuizContext`'s courseId-not-found fallthrough** (extracted, shared
by both actions in PR-3a): a `courseId` for a course that does NOT exist at
all (not merely wrong-org) leaves `courseContext` empty and silently falls
through to `options.context`, unlike a cross-org courseId which explicitly
returns "Course not found." Pinned as a new test since it wasn't previously
covered, to guard the shared extraction against drifting this behavior.

See also [Course wizard 9-step redesign test patterns](course-wizard-9step-redesign-tests.md) for the prior AI-upload-bypass-via-deep-link technique this PR's Step2Upload also uses, and [full e2e suite serial flakiness](full-e2e-suite-serial-flakiness.md) for the stale-DB-row pollution pattern — reconfirmed here: re-running `course.spec.ts`'s ENG-022 test twice against the same unseeded DB produces a real "2 rows" strict-mode Playwright failure from the test's own prior side effect (an `assignRetake()` call), not a regression. Always reseed between repeated local e2e runs of the same spec.
