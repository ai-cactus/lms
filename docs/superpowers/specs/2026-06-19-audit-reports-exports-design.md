# Audit Reports — Detailed Audit Trails & PDF Exports

**Date:** 2026-06-19
**Status:** Approved (design)
**Branch:** feat/export

## Summary

Rename the "Auditor Pack" feature to **"Audit Reports"** and build proper,
well-formatted **PDF** export across its Overview, Courses, and Staff tabs.
Every export runs as a **non-blocking async job** (the admin can keep working);
when the job finishes the PDF **auto-downloads in the browser once** and can be
**re-downloaded** afterward. **No email is sent** (this overrides the original
ticket note about emailing the current user).

PDF is the **default** export format everywhere. Existing CSV/DOCX exports
remain only as secondary options inside the Export tab.

## Decisions (from clarification)

- **Label:** "Audit Reports" (matches design mockups), and the route is renamed.
- **Delivery:** Download in browser only. **No email.**
- **Generation:** Async job + queue, non-blocking; auto-download on completion +
  re-download available.
- **Scope (lean):**
  - Course PDF = course content/meta + documents-used (evidence list) + quiz
    rules + every assigned staff member's performance.
  - Staff PDF = that staff's full transcript (courses, results, attempts,
    retakes).
  - Overview PDF = org-wide summary + full activity.
  - "Lean" = summary tables only. Do **not** embed raw quiz question text or full
    document file contents.
- **Toast:** add `sonner` for the completion toast (app currently has no toast lib).
- **Documents used:** rendered as an evidence list (filename + version + hash),
  not embedded contents.

## Section 1 — Rename (Auditor Pack → Audit Reports)

Display-only rename. Internal identifiers stay to avoid a risky wide rename.

- Move route directory:
  `src/app/dashboard/(main)/auditor-pack/` → `src/app/dashboard/(main)/audit-reports/`.
- Add a redirect from `/dashboard/auditor-pack` → `/dashboard/audit-reports`
  (Next.js `redirect()` in a thin retained page, or `next.config` redirect).
- Update user-facing strings to **"Audit Reports"**:
  - Sidebar nav: `src/components/dashboard/DashboardLayoutClient.tsx:159`
    (and the `href` to the new route).
  - Page `<h1>` + `<title>` metadata:
    `src/app/dashboard/(main)/audit-reports/page.tsx` (lines ~11, ~66).
  - Tab `aria-label`: `AuditorPackClient.tsx:34`.
  - Welcome banner / description copy as needed.
- **Keep unchanged (internal):** `organization.hasAuditorAccess`,
  `src/app/actions/auditor.ts`, the `api/auditor/...` route folder, the
  `AUDITOR_PACK_EXPORT` job type, component filenames (`Auditor*`). These are
  not user-visible.

## Section 2 — Export architecture (one async pipeline, three scopes)

Reuse and generalize the existing BullMQ `Job` pipeline.

### Job payload

Extend the start payload with a scope discriminator:

```ts
type ExportScope = 'org' | 'course' | 'staff';

interface ExportJobPayload {
  organizationId: string;
  dbJobId: string;
  scope: ExportScope;
  scopeId?: string; // courseId when scope='course', userId when scope='staff'
}
```

### Start endpoint — `POST /api/auditor/export/start`

- Body: `{ scope: ExportScope, scopeId?: string, format?: 'pdf' }` (format
  defaults to `pdf`).
- Auth: existing admin + `hasAuditorAccess` checks.
- **Authorization of scopeId** (new): when `scope='course'`, verify the course is
  owned by / assigned within the admin's org; when `scope='staff'`, verify the
  user belongs to the admin's org. Reject with 403 otherwise.
- Create the `Job` row (`type: 'AUDITOR_PACK_EXPORT'`, `status: 'queued'`,
  `payload: { progress: 0, message, scope, scopeId }`) and enqueue to
  `auditor-export-queue`.
- Return `{ jobId }`.

### Worker — `src/lib/queue/auditor-export-worker.ts`

- Read `scope` / `scopeId` from job data; branch the enrollment query:
  - `org`: all enrollments for org users (current behavior).
  - `course`: org enrollments filtered by `courseId = scopeId`, plus course
    meta, quiz rules, and documents-used (via `CourseVersion → DocumentVersion`).
  - `staff`: all enrollments for `userId = scopeId`, plus staff identity.
- Compute a **scope-specific structured result** and store it in `Job.result`.
  The worker does **not** render the PDF (keeps it fast/generic). Progress
  milestones as today.

### Status — `GET /api/auditor/export/[jobId]/status`

Unchanged: returns `{ jobId, status, progress, message }` with tenant isolation.

### Download — `GET /api/auditor/export/[jobId]/download?format=pdf`

- Add a `pdf` branch (alongside existing `csv`/`docx`).
- Render the PDF from `Job.result` using the appropriate generator based on the
  job's stored `scope`. PDF rendering from precomputed data is fast (no heavy DB
  work here).
- Headers: `Content-Type: application/pdf`,
  `Content-Disposition: attachment; filename="Audit_Report_<scope>_<name>_<date>.pdf"`.
- Tenant isolation: confirm the job belongs to the requester's org.

### Download UX — `ExportJobsProvider`

A small client context mounted in the dashboard layout:

- Tracks in-flight export jobs in state + `localStorage` (survives in-app
  navigation; survives reload for re-download, though auto-download only fires
  once per job).
- Polls each active job's status endpoint (~1.5s) until terminal.
- While running: inline loader on the triggering button + lightweight progress.
- On `completed`: trigger a one-time browser download of
  `…/download?format=pdf`, and show a `sonner` toast with a **"Download again"**
  action. On `failed`: error toast.
- Past/ready exports are also listed in the **Export tab** for re-download.

The existing Export-tab "PDF emailed to admin" flow is **removed** and replaced
by this download flow. Email lib functions (`sendAuditorPackPdfEmail`, etc.)
remain in the codebase but are no longer called from exports.

## Section 3 — PDF report content (lean)

Refactor `src/lib/pdf-reports.ts` to extract shared helpers
(branded header, paginated table, footer) and add three generators. Each takes a
typed, precomputed input (built by the worker / download route) and returns a
`Buffer`.

### Course PDF — `generateCourseAuditPdf`

- Header: course title, org name, generated date.
- Course meta: category, type (text/video), skill level, status, objectives,
  duration.
- Quiz rules summary: passing score, allowed attempts, time limit, number of
  questions. (No raw question text.)
- Documents used (evidence): filename/originalName + version + hash, from
  `CourseVersion → DocumentVersion`. (Contents not embedded.)
- Staff performance table: per assigned staff → name, status, score, attempts,
  completed date.

### Staff PDF — `generateStaffAuditPdf`

- Header: staff name, role/job title, org.
- Transcript table: course, type, category, status, score, attempts/retakes,
  date assigned, date completed.

### Overview / Org PDF — `generateOrgAuditPdf`

- Org summary: total courses, total staff, completion rate.
- Full activity table: every staff × course enrollment with status, score,
  assigned/completed dates.

### Data gap

The Staff mockup shows a "Department/Role" column, but there is no `department`
field in the schema (`Profile.jobTitle`, `User.role` exist). Display
**jobTitle, falling back to role**. The mockup's repeated names across
departments are mock data; real output is **one row per staff**.

## Section 4 — UI changes (matching mockups)

- **Courses tab** (`AuditorCoursesTab.tsx`): "Export all" button now triggers a
  PDF org-courses export; **add an `ACTION` column** with a per-row "Export" link
  that triggers a per-course PDF (Image #4).
- **Staff tab** (`AuditorStaffTab.tsx`): **add an "Export all"** button (currently
  none) and **add an `ACTION` column** with a per-row "Export" link for a
  per-staff PDF (Image #5).
- **Overview tab** (`AuditorOverviewTab.tsx`): existing Export button now triggers
  the org-wide activity PDF.
- All export triggers go through `ExportJobsProvider` (loader → auto-download →
  re-download toast).

## Out of scope

- No email delivery.
- No new "department" data model.
- No change to internal identifiers / billing flag names.
- No embedding of raw quiz questions or full document file contents in PDFs.

## Affected files (anticipated)

- `src/app/dashboard/(main)/auditor-pack/` → `…/audit-reports/` (+ redirect)
- `src/components/dashboard/DashboardLayoutClient.tsx`
- `src/components/dashboard/auditor/AuditorPackClient.tsx`
- `src/components/dashboard/auditor/AuditorOverviewTab.tsx`
- `src/components/dashboard/auditor/AuditorCoursesTab.tsx`
- `src/components/dashboard/auditor/AuditorStaffTab.tsx`
- `src/components/dashboard/auditor/AuditorExportTab.tsx`
- New: `ExportJobsProvider` (dashboard layout) + toast setup (`sonner`)
- `src/app/api/auditor/export/start/route.ts`
- `src/app/api/auditor/export/[jobId]/download/route.ts`
- `src/lib/queue/auditor-export-worker.ts`
- `src/lib/pdf-reports.ts` (shared helpers + 3 generators)
- `package.json` (`sonner`)
