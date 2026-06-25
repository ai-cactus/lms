# Video Course Soft-Delete & Edit — Design

**Date:** 2026-06-16
**Status:** Approved (pending spec review)
**Area:** System back-office — `/system/video-courses`

## Problem

Deleting a video course from `/system/video-courses` fails:

```
Foreign key constraint violated: `Enrollment_courseId_fkey` (P2003)
prisma.course.delete()
```

Root cause: `prisma.course.delete()` is blocked by Course foreign keys that do **not** cascade, while every other Course relation does:

- `Enrollment.course` (schema.prisma:428) — no `onDelete` → defaults to **Restrict**. This is the error currently thrown; any enrollment blocks the delete.
- `Certificate.course` (schema.prisma:662) — `onDelete: Restrict`. Certificate has a **direct** FK to Course (separate from its enrollment FK), so issued certificates would block the delete next.

These `Restrict` rules are deliberate: they protect worker completion/attestation/certificate records. For **compliance, courses must never be hard-deleted.**

## Decisions (from brainstorming)

- **No hard delete.** "Delete" becomes a **soft delete**: the course `status` is set to `inactive`.
- An inactive course **disappears from the platform's available courses** and is no longer offerable/enrollable, but **still shows on the system page** (where it can be reactivated). Existing enrollments and certificates are untouched.
- Admins can **edit** a video course — any field plus chapter/lecture structure and videos (preview + lecture). **Quiz editing was out of scope** for this round (Option 3). _(Superseded 2026-06-21: quiz re-upload now supported — see `docs/superpowers/specs/2026-06-21-video-course-quiz-update-design.md`.)_
- Edit lives on a **dedicated page** (`/system/video-courses/[courseId]/edit`).
- Save uses **Approach A**: one server action reconciling the full desired course tree in a transaction.
- The system list uses a **toggle** action: Deactivate ⇄ Reactivate, inactive courses stay visible with an "Inactive" badge.

## Data model

Add `inactive` to the `CourseStatus` enum:

```prisma
enum CourseStatus {
  draft
  published
  inactive
}
```

Run a Prisma migration. **No FK changes** — the `Restrict` rules on `Enrollment.course` / `Certificate.course` stay correct now that we never hard-delete.

## Soft-delete / reactivate

Replace `deleteVideoCourse` with:

```ts
setVideoCourseStatus(courseId: string, status: 'inactive' | 'published'): Promise<void>
```

- System-admin gated (`assertSystemAdmin`).
- Updates `course.status`; preserves all rows.
- `revalidatePath('/system/video-courses')`.

This relies on existing platform filters (already in place) and one new guard:

- `offering.ts:60` (`getAvailableVideoCourses`) — already filters `status: 'published'`; inactive courses drop off the org's available list.
- `offering.ts:189` (add-offering validation) — already requires `status: 'published'`; inactive can't be newly offered.
- **NEW:** `enrollment.ts` enroll-staff guard (around line 106) authorizes a global course purely by "an `OrgCourseOffering` row exists" and does **not** check status. Since deactivation deliberately keeps existing offerings, add a `course.status === 'published'` check so no *new* staff can be enrolled into an inactive course. Existing enrollments don't go through this path and are unaffected.

`listGlobalVideoCourses` (`video-course.ts:194`, the system page) keeps **no** status filter — it shows all courses, including inactive — and now also selects `status`.

## System list UI (`VideoCoursesClient`)

- Add a **course-status badge** ("Active" / "Inactive"), distinct from the existing media-status badge.
- Row menu actions:
  - **Edit** → navigates to the edit page.
  - **Deactivate** (when active) / **Reactivate** (when inactive) → calls `setVideoCourseStatus`.
- Confirm copy for deactivate: "Deactivate this course? It will be hidden from organizations and can no longer be enrolled in, but all records are kept. You can reactivate it later." (No "permanently remove" wording.)
- `VideoCourseRow` gains a `status` field.

## Edit page (`/system/video-courses/[courseId]/edit`)

- **Server component** loads the course with `modules → lessons` (ordered) and the course-level `quiz` (with question count), then renders the client edit form. 404 if not a `type: 'video'`, `isGlobal: true` course.
- The large create form is **extracted into a shared `VideoCourseForm` component** used by both create and edit (`mode: 'create' | 'edit'` + `initialValues`). This removes ~300 lines of duplication (chapter/lecture builder, video pickers, `probeVideoDuration`, `uploadVideo`) and is the targeted cleanup that serves this work.
- In edit mode, existing chapters/lectures are pre-filled. Each existing lecture shows its current video as "current" with a "Replace video" control; choosing a new file marks that lecture's video as changed.
- The quiz section was originally **read-only** in edit mode (count + passing score only). **Superseded 2026-06-21:** the edit page now offers an optional "Replace quiz file" picker that fully replaces the quiz from a new CSV/JSON upload — see `docs/superpowers/specs/2026-06-21-video-course-quiz-update-design.md`.

## `updateVideoCourse` server action (Approach A)

```ts
updateVideoCourse(courseId: string, input: UpdateVideoCourseInput): Promise<void>
```

`UpdateVideoCourseInput` carries course fields plus the desired module tree. Existing chapters/lectures carry their `id`; new ones omit it; removed ones are absent. Client uploads any new/replacement videos first (reusing `POST /api/system/video-courses/upload`) and passes the resulting `storageUri`.

One `prisma.$transaction`:

1. **Course fields:** update title, description, overview, skill level, category, duration, preview video URI. Update passing score / allowed attempts on the course-level `Quiz`.
2. **Chapters (`CourseModule`):**
   - matched by `id` → update title/order;
   - no `id` → create;
   - missing from input → **delete its lessons first** (because `Lesson.module` is `onDelete: SetNull` and would otherwise orphan them), then delete the module.
3. **Lectures (`Lesson`):** matched → update title/order (+ video if changed); new → create; missing → delete.
4. **Video replacement:** any lecture whose `videoStorageUri` differs from the stored value, and the preview if its URI changed, get `mediaStatus` / `previewMediaStatus: 'processing'`.

After the transaction (best-effort, mirroring create): enqueue exactly one transcode job per changed/new video via `enqueueVideoTranscode`; on failure, clear the `processing` flag so the UI doesn't hang. Unchanged videos are left untouched (no re-transcode).

`revalidatePath('/system/video-courses')` and the edit path.

## Testing

Extend `src/app/actions/video-course.test.ts`:

- `setVideoCourseStatus` sets `inactive` and back to `published`; row is preserved (no delete).
- Inactive course is excluded from `getAvailableVideoCourses` and rejected by add-offering and enroll-staff guards; still returned by `listGlobalVideoCourses`.
- `updateVideoCourse`:
  - updates course/quiz fields;
  - creates a new lecture, updates an existing one, deletes a removed one;
  - deleting a chapter removes its lessons (no orphans);
  - a changed lecture/preview video URI flips `processing` and enqueues exactly one transcode; unchanged videos do not enqueue.

## Out of scope (this round)

- Quiz editing (questions / re-upload). **Resolved 2026-06-21:** quiz re-upload (full replace) shipped — see `docs/superpowers/specs/2026-06-21-video-course-quiz-update-design.md`.
- Drag-and-drop reordering (order is derived from array position).
- Revoking existing org offerings or enrollments on deactivation (intentionally preserved for compliance).
