---
name: report-conventions
description: QA reports are Markdown (.md) only, in qa-reports/, named with a date prefix (YYYY-MM-DD-<slug>.md), with no PDF conversion
metadata:
  type: reference
---

**Reports are Markdown only.** Write the report as a `.md` file with the `Write` tool. Do NOT convert to PDF — the old `npx md-to-pdf` flow is retired.

**Report location:** `<repo-root>/qa-reports/` (gitignored — never committed). Create the folder if it doesn't exist. Note: the repo root path varies by machine/environment (e.g. observed as `/home/dokimazo-tech/dev247/lms/qa-reports/` on 2026-07-01) — always resolve relative to the current working directory rather than hardcoding a path.

**Naming convention: date-prefixed**, `YYYY-MM-DD-<slug>.md`, e.g. `qa-reports/2026-09-21-backlog-clearing-batch.md`. A retest on a new day gets a new dated file; a same-day retest overwrites that day's file. In generate-stories mode, write either one dated `.md` per story or one consolidated `YYYY-MM-DD-<area-slug>.md` with a section per story.

**Report spine:** a per-criterion acceptance-criteria results table (`# | criterion | Expected | Actual | Result`); in generate-stories mode also a top-level summary table across stories. Save screenshots/video alongside and link them by relative path so links resolve from inside `qa-reports/`.
