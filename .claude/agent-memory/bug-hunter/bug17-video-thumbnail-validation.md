---
name: bug17-video-thumbnail-validation
description: Validated BUG-17 (video-course thumbnails) on branch bugfix/video-course-thumbnails — proxy.ts gate made a route's system-cookie fallback dead (fixed via the system route); e2e system-admin auth gotchas
metadata:
  type: project
---

Full-branch validation (2026-09-22) of the video-course-thumbnail feature: new
`Course.thumbnailStorageUri` column, `src/lib/video/thumbnail.ts` resolver
(custom → preview poster → lesson poster → none), the serving route
`/api/courses/[id]/thumbnail`, the upload route
`/api/system/video-courses/[courseId]/thumbnail`, `ThumbnailPanel.tsx`, and DTO
plumbing through `course.ts`/`offering.ts`/`staff.ts`/`auditor.ts`. Unit suite
360 files/6080 tests + 1 new proxy regression (failed until fixed — see below), typecheck/lint clean, build green, migration
(`20260922100000_add_course_thumbnail_storage_uri`, single additive ALTER)
applies cleanly to `lms_e2e`. Full `npm run e2e:local` (CI parity): 215 tests,
202 passed, 13 skipped, 0 failed.

**Proxy gate vs. a route's own fallback auth (found here, since fixed):**
`src/proxy.ts`'s `gateApiRoute()` requires an admin/worker NextAuth portal
session for every `/api/**` route except `SELF_AUTHENTICATED_API_PREFIXES =
['/api/system/']`. The first cut of ThumbnailPanel previewed through
`/api/courses/[id]/thumbnail`, whose handler also accepted the
`system_admin_auth` cookie — but the proxy 401'd a system admin (no portal
session) before that fallback could run, so it was dead code. Confirmed live:
the page's SSR data was correct while its `<img>` 401'd, because the page
render and the image fetch go through different auth paths. **Fix chosen by
the orchestrator (no proxy change):** the preview is served by a GET on
`/api/system/video-courses/[courseId]/thumbnail` (system-cookie gated,
`no-store`), and the portal route's system-cookie branch was removed.
`src/proxy.test.ts` now pins BOTH outcomes: the portal thumbnail path 401s
with only the system cookie, and the system path is passed through. Lesson:
when a route accepts an alternative credential, check every earlier layer
(proxy) also lets that credential through — same class as
[[proxy-redirect-during-server-action-crash]].

**Playwright `toBeVisible()` does not prove an `<img>` actually decoded.** A
broken image (401, 404, CORS) still occupies its layout box and passes
`toBeVisible()`. This is exactly what let the proxy bug above through my own
first pass of the new e2e spec (`tests/e2e/system-video-course-thumbnail.spec.ts`)
undetected — the spec asserted visibility and the source label text (both
correct) but not that pixels loaded. Fixed by polling
`image.evaluate(el => el.naturalWidth) > 0` after every image-affecting step.
Worth defaulting to this whenever an e2e spec asserts an `<img>` "shows" —
visibility alone is a weak proxy for "loaded successfully".

**System-admin login: `waitForURL` after the login click is a false-positive
trap.** The unauthenticated and authenticated views of `/system` are both
served at the SAME URL (`router.push('/system'); router.refresh()` — no real
navigation), so `page.waitForURL('**/system')` resolves instantly against the
pre-login URL, before the async server action that sets the cookie has even
returned — the test then races ahead and looks unauthenticated everywhere
downstream (empty password field, disabled button in the failure screenshot,
because THAT'S the fresh login form on the next unauthenticated page,
misleadingly showing as if `.fill()` never worked). Cost real debugging time
because a raw `chromium.launch()` script without `waitForURL` "just worked",
making the login helper look fine in isolation. Fix: wait for something only
the authenticated layout renders, e.g.
`expect(page.getByRole('link', { name: 'Video Courses' })).toBeVisible()`.

**`/system/**` is entirely unreachable in the default local/CI e2e
environment.** `.env.e2e` (committed) does not set `SYSTEM_ADMIN_PASSWORD`,
and `isSystemAdminEnabled()`/`isEnabled` gates the WHOLE `/system` layout with
`notFound()` when it's unset — not just a login-form block. This is why
`reminders.spec.ts`'s REM-003/REM-004 self-skip on
`PLAYWRIGHT_SYSTEM_ADMIN_COOKIE`, and it's a strictly earlier gate than that
cookie: even a perfectly valid `system_admin_auth` cookie is useless if the
server process never had `SYSTEM_ADMIN_PASSWORD` set. To actually exercise
`/system/**` live locally: `export SYSTEM_ADMIN_PASSWORD=<anything>` in the
shell BEFORE `npm run e2e:local` (or before manually running `npm run start`)
— it flows through `scripts/with-e2e-env.sh` and Playwright's `webServer`
spawn (both merge with, not replace, the parent env) since `.env.e2e` never
defines that key. Never add it to the committed `.env.e2e` as a side effect of
a validation session — that would silently turn on REM-003/REM-004 and every
other `/system/**` e2e flow in CI, which is a scope decision for the team.
`tests/e2e/system-video-course-thumbnail.spec.ts` self-skips on the same env
var with this reasoning in its header comment.

**Global (`isGlobal: true`) video courses do NOT appear in an org's own
`/dashboard/courses` management table** — that page is `getCourses()`
(org-owned + adopted offerings only). `isGlobal` courses only surface through
`listGlobalVideoCatalogCourses()`, consumed solely by `getAssignableCourses()`
(the Assign-course picker). Cost a wasted seed+screenshot round: seeded a
`system`-org-owned global course expecting it to show on
`/dashboard/courses`, got "0 Video Courses" even after a server restart
(ruled out cache staleness). For a screenshot/test of the ordinary course-list
UI showing a real poster, seed an ORG-OWNED course instead (`isGlobal: false`,
`organizationId` = the target org, `createdByOrgUserId` = one of its real
`organization_users` rows) — see [[courses-and-documents-are-global]] and
[[video-courses-preowned-decision]], neither of which states this distinction
explicitly.

Seeding pattern for a video course with a real poster (no ffmpeg needed): a
lesson row with `video_poster_storage_uri` pointing at a real JPEG uploaded to
MinIO directly via the `minio` npm client (`sharp({create:...}).jpeg()` to
generate the bytes in-process) — same technique as
[[course-list-status-thumbnails-validation]]'s visual-check fixture, extended
with a real poster object so the thumbnail route has something genuine to
stream. `videoStorageUri` itself can be a non-existent object — extraction
(`ffmpeg`) fails long before the URI is dereferenced in an environment with no
ffmpeg binary (`nice ffmpeg ...` → exit 127, "ffmpeg: No such file or
directory" — NOT caught by the code's own `isMissingBinary()` ENOENT check,
since `nice` itself IS found; only a totally missing `nice` would fall back to
a direct un-niced `ffmpeg` call). This is why "Regenerate from video" safely
refuses with a user-facing alert in this environment — expected, not a bug —
and is exactly the assertion the new e2e spec makes for that step.

**Re-validation round (2026-09-22), after the GET-route fix landed:** full
unit suite 360 files/6091 tests green, typecheck/lint/build clean, single-spec
`system-video-course-thumbnail.spec.ts` run (`SYSTEM_ADMIN_PASSWORD` exported
inline, never written to `.env.e2e`) passed, and a full `npm run e2e:local`
re-run passed 202/13-skipped/0-failed. Confirmed live via `naturalWidth`
that both the edit page's initial lesson-poster preview and a freshly
uploaded custom thumbnail now decode real pixels through
`/api/system/video-courses/[courseId]/thumbnail`, closing BUG-17.
`@playwright/mcp` in this sandbox is configured for the `chrome` channel,
which isn't installed and can't be (`sudo` needs a TTY) — it errors with
"Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome".
The `claude-in-chrome` extension is also unavailable ("Browser extension is
not connected"). The `playwright-cli` skill's own `open`/`goto`/etc. commands
use Playwright's bundled chromium build directly (already installed at
`~/.cache/ms-playwright/chromium-*`, no root needed) and worked fine for the
manual screenshot pass — prefer it over the MCP tool for manual
browser-driven checks in this environment.
