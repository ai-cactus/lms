---
name: report-conventions
description: QA reports are Markdown (.md) only — location, naming, no PDF conversion
metadata:
  type: reference
---

**Reports are Markdown only.** Write the report as a `.md` file with the `Write` tool. Do NOT convert to PDF — the old `npx md-to-pdf` flow is retired.

**Report location:** `/Users/chaonyeji/Devs/Theraptly/lms/qa-reports/` (gitignored — never committed). Create the folder if it doesn't exist.

**Naming convention:** `<user-story-slug>.md` e.g. `login-user-story.md`. Overwrite on retest — no timestamped duplicates. In generate-stories mode, either one `.md` per story or one consolidated `<area-slug>.md` with a section per story.

**Report spine:** a per-criterion acceptance-criteria results table (`# | criterion | Expected | Actual | Result`); in generate-stories mode also a top-level summary table across stories. Save screenshots/video alongside and link them by relative path so links resolve from inside `qa-reports/`.
