---
name: gotcha-tracker-items-may-already-be-fixed
description: OPEN-ISSUES.md entries can already be fixed on dev (TOOL-09 was, by 311375cc); check git log -S before "fixing"; plus the no-ffmpeg fixture recipe
metadata:
  type: project
---

`docs/local/OPEN-ISSUES.md` lives outside git, so a PR that fixes an item does
not always move it. TOOL-09 ("staff-assign-multiple-courses.spec.ts is
describe.skip") was still listed on 2026-09-28 although 311375cc (BUG-20,
2026-09-23) had already ported the seed and un-skipped it.

**Why:** re-doing a landed fix wastes the batch and risks clobbering it.

**How to apply:** before working a tracker item, `git log -S '<the symptom string>'
-- <file>` (e.g. `-S "describe.skip"`) and read the file on the fresh branch.
Report an already-fixed item to the orchestrator so the tracker gets updated —
agents in worktrees cannot edit the gitignored tracker themselves.

No system ffmpeg here: `npm install ffmpeg-static` in the SCRATCHPAD (never the
repo) yields a static 7.x binary at `node_modules/ffmpeg-static/ffmpeg`;
`FFMPEG=<that path> tests/e2e/fixtures/generate-video-fixture.sh` uses it.
