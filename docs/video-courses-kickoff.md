# Course migration finish + Video Courses — Kickoff (handoff for the next conversation)

**Created:** 2026-06-11. Read this first, then `docs/ui-migration-progress.md` (live migration status) and `docs/ui-migration-pattern.md` (Tailwind/shadcn conventions).

Two-phase plan, agreed with the user. Branch: continue on `feature/auth-ui-migration` (or a fresh `feature/courses-and-video`). **Do not commit unless asked — the user commits.**

---

## Phase 1 — Finish the course/creation UI migration (do FIRST, clean base)

Migrate the remaining **course-related** pages to Tailwind + shadcn (presentation-only, preserve all functionality), following `ui-migration-pattern.md` (§3a tables + `RowActionsMenu` kebab; collapse-don't-scroll responsive tables; verify each via a temp preview route + `npx tsx scripts/shot.ts`). Remaining:
- `(wizard)/courses/create` — the multi-step course-creation wizard + its step components (largest; `components/dashboard/training/*` and `components/courses/*`).
- `courses/queue`, `courses/[id]/mapping`.
- `(main)/training`, `training/courses/[id]` (+ `/preview`, `/results/[enrollmentId]`).
- `(main)/documents/[id]` detail (shares `documents/page.module.css` — can delete that module once detail is ported).
- Any remaining `components/courses/*`.

Already done in the dashboard slice: shell, home, Courses list, Documents list, Staff (profile + list), reusable `RowActionsMenu`. See the tracker.

## Phase 2 — Video Courses (NEW feature; priority). Start with `superpowers:brainstorming` → spec → plan.

**What it is:** Today courses are *text* (AI-generated from an org's uploaded documents, org-scoped). Add **video courses** as **platform-global content**:
- The **SYSTEM ADMIN uploads** the video **+ its quiz** in the **back office** (the system area — `src/app/system/*`, `components/system/*`; not the org-admin dashboard). NOT created by org admins, NOT AI-generated.
- Once uploaded, a video course is **available to ALL organizations and their admin users** (a shared global catalog).
- An **org admin** browses/assigns a global video course to their staff. The **staff watch the video then take the quiz** — same enrollment/scoring/certificate flow as text courses.
- **Keep the existing text-course (org-scoped, AI) flow fully functional.**

### Decisions locked with the user (2026-06-11)
- **Authoring location:** system admin, in the **back office** (`src/app/system`). Org admins only **assign** existing global video courses — they don't upload/create them.
- **Scope:** video courses are **global / cross-org** (one upload → usable by every org). This is the key tension with the current Course model (see below).
- **Hosting:** **Self-host now** (upload to the project's existing storage — `@google-cloud/storage` / `minio`, see `src/lib/storage`), **but design it pluggable** — abstract a video-source/provider interface so other methods (Mux / Cloudflare Stream / Vimeo / external embed) can be added later without reworking the player/course pages.
- **Quiz authoring:** the system admin **uploads a quiz file (CSV/JSON)** with the video. Needs a defined schema + import/validation UI, mapping into the existing quiz/question model. _(Update 2026-06-21: the quiz file can also be **replaced** later from the course edit page — a new upload fully replaces every question. See `docs/superpowers/specs/2026-06-21-video-course-quiz-update-design.md`.)_
- **Data model:** **extend the existing `Course`** with `type: 'text' | 'video'`, reusing enrollment/quiz/certificate/assignment. BUT the current `Course` is **org-scoped** — a global video course needs the content to be org-agnostic while **enrollments stay per-staff/per-org**. Resolve in brainstorming after inspecting `prisma/schema.prisma`: likely a global Course row (e.g. `organizationId = null` + `type='video'` + an "available to all orgs" flag) that orgs **assign** via per-staff enrollments; or a global catalog table orgs reference. Add fields for the video source (provider + key/url). Keep text-course rows unchanged.
- **Org-side UX (decided):**
  - **Admin dashboard home:** show a separate **"Available Courses" table** (~5 global video courses) **above or below the existing "My Courses" table**. (Home is already migrated — this table is a Phase-2 addition.)
  - **Courses page:** make it **tabbed** — one tab = the org/admin's own courses (the current `CoursesListClient` list), a separate tab = the full **paginated video / "Available" courses** list. The two course types live in separate tabs, not mixed.
- **Priority:** video first; text flow must keep working throughout.

### Design
- The **video-course feature designs are NOT complete** — **do not rely on Figma for it; the user will guide the UI as needed.** (The `12539-30421` board has the *existing* course-creation screens for Phase 1, but its video-course screens are incomplete — ignore them.) Reuse the established dashboard table/tab/kebab patterns from `ui-migration-pattern.md`.

### Brainstorming should resolve (open questions for the spec)
- **Model scoping (biggest):** how a global video `Course` coexists with org-scoped text courses — global row (`organizationId = null`) + per-staff enrollment vs a separate global catalog the orgs reference. Inspect schema + `getCourses`/assignment actions first.
- **Back-office upload UX:** the system-admin "Upload Video Course" screen in `src/app/system` (video file + CSV/JSON quiz + metadata). Where exactly in the system area; what fields.
- **Assignment mechanism:** from the Courses-page video tab (and/or the dashboard "Available Courses" table), how an org admin assigns a global video course to staff — reuse `AssignUserCourseModal` / the existing enrollment flow? (Discovery UX itself is decided: dashboard "Available Courses" table + tabbed Courses page.)
- **CSV/JSON quiz schema** (columns/shape) + validation + mapping to existing quiz questions/options/correct-answer/explanation.
- **Completion gating:** must staff watch the full video (or X%) before the quiz unlocks/counts? Playback-progress tracking model.
- **Large-file upload** for self-host (chunked/resumable? size limits? PHI/compliance on stored video; back-office only).
- **Player component** (pluggable source interface) + where it renders in `training/courses/[id]` for staff.
- **Pluggable-hosting interface** shape (so Mux/Cloudflare/embed drop in later).

## How to resume verification/build
- Dev server `npm run dev` (port 3005). Auth-gated dashboard pages: verify via a temporary unprotected preview route (e.g. `src/app/xpreview/page.tsx` rendering the client component inside `DashboardLayoutClient` with mock props) + `npx tsx scripts/shot.ts /xpreview`, then delete it.
- Gates: `npm run lint && npx tsc --noEmit && npm test`; production build `npm run build`.
