# Video Courses — Design Spec

**Created:** 2026-06-11 · **Branch:** `feat/video-course` · **Status:** approved design, pre-plan
**Companion:** `docs/video-courses-kickoff.md` (locked product decisions) · `docs/ui-migration-pattern.md` (UI conventions)
**Do not commit unless asked — the user commits.**

---

## 1. Summary

Add **video courses** as **platform-global content** alongside the existing org-scoped, AI-generated **text courses**.

- A **system admin** uploads, in the back office (`src/app/system`), a **video file + a quiz file (CSV or JSON)** + metadata. This creates a **global** course in a shared catalog. Org admins do **not** author them; they are **not** AI-generated.
- An **org admin** browses the global catalog, **offers** (adopts) a video course into their org, and **assigns** it to specific staff.
- **Staff** watch the video, then take the quiz. **Completion requires passing the quiz at the course's set passing score** (the watch-gate only unlocks the quiz).
- The existing **text-course flow stays fully functional and untouched.**

### Design principle: reuse, don't duplicate
Three layers from the originally-proposed architecture already exist in the schema and are reused verbatim: per-staff progress = **`Enrollment`**, per-staff quiz answers = **`QuizAttempt`**, the quiz question bank = **`Quiz` + `Question`**, completion record = **`Certificate`**. This makes **unified reporting across text + video courses free** — every existing dashboard/report/staff-profile aggregates over `Course`/`Enrollment` already. We add **only** the genuinely-new pieces: a `type`/`isGlobal` discriminator on `Course`, video fields on `Lesson`, the **org-mapping layer** (`OrgCourseOffering`), and a **pluggable video-source provider**.

---

## 2. Locked decisions (2026-06-11)

| # | Decision |
|---|---|
| 1 | **Reuse** `Enrollment`/`QuizAttempt`/`Certificate` (hybrid), not parallel `StaffVideoProgress`/`StaffQuizAnswers`. |
| 2 | **Admin-to-staff assignment**: adopting a global course offers it to the org; the org admin then assigns specific staff (per-staff `Enrollment`, same as text courses — due dates/attestation/certificates consistent). |
| 3 | Quiz file = **both CSV and JSON**; the back office provides **downloadable sample templates** for each. |
| 4 | Video upload v1 = **direct, size-capped** upload to existing storage (GCS/MinIO). **Pluggable** so streaming platforms (Mux/Cloudflare/embed) drop in later. |
| 5 | Global video courses are owned by a single seeded **"System" `User`** (`Course.createdBy` FK stays satisfied). |
| 6 | **Watch gate ≈ 95%** unlocks the quiz; **the hard completion requirement is passing the quiz at `Quiz.passingScore`.** |

---

## 3. Data model

### 3.1 Changes to existing models (additive, non-breaking)

```prisma
enum CourseType { text  video }          // NEW enum, default text

model Course {
  // … existing fields unchanged …
  type      CourseType @default(text)     // NEW
  isGlobal  Boolean    @default(false)    // NEW — true = shared global catalog (video)
  // createdBy: unchanged required FK → seeded System user for global video courses
  offerings OrgCourseOffering[]           // NEW back-relation
  @@index([type])
  @@index([isGlobal])
}

model Lesson {
  // … existing fields unchanged …
  videoProvider        String?   // 'self' | 'mux' | 'cloudflare' | 'embed' (v1: 'self')
  videoStorageUri      String?   // gcs://… / minio://… (self-host) OR external id/url
  videoDurationSeconds Int?
}

model Enrollment {
  // … existing fields unchanged …
  videoPositionSeconds Int?      // resume point; existing `progress` Int holds watched-%
}
```

- **Text courses are unaffected**: `type` defaults to `text`, `isGlobal` to `false`; all new columns are nullable/defaulted.
- The video is modeled as a **`Lesson`** on the global `Course` (usually a single lesson), so it renders in the lesson/player view **just like notes/slides today**, and `Quiz`/`Question` hang off that lesson exactly as in the text flow. Multi-lesson video courses are naturally supported later with no schema change.

### 3.2 New model — the org-mapping layer

```prisma
model OrgCourseOffering {
  id                String   @id @default(uuid())
  organizationId    String
  courseId          String                       // → global video Course
  addedByAdminId    String                        // org admin who adopted it
  customTitle       String?                        // per-org rebranding (optional)
  customDescription String?
  customIntro       String?
  createdAt         DateTime @default(now())
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  course            Course       @relation(fields: [courseId], references: [id], onDelete: Cascade)
  @@unique([organizationId, courseId])            // an org offers a course at most once
  @@index([organizationId])
  @@index([courseId])
}
```
(`Organization` gains `offerings OrgCourseOffering[]`.) This drives the org's "Available / System Training" surfaces and optional per-org rebranding. Enrollments still tie to `userId` (org derived from the user), so who-can-be-assigned is naturally org-scoped.

### 3.3 Seeded System user (migration/seed)
A single deterministic `User` (e.g. `email = "system@theraptly.internal"`, `role = admin`, `organizationId = null`) created via a seed/migration; its id is the `createdBy` for every global video `Course`. Idempotent upsert by email.

### 3.4 Migration notes
- Add `CourseType` enum + `Course.type`/`isGlobal` + indexes; `Lesson.video*`; `Enrollment.videoPositionSeconds`; `OrgCourseOffering`; seed System user. All additive — `prisma migrate` is non-destructive. No backfill needed (existing rows default to `text`/non-global).

---

## 4. Pluggable video source

```ts
// src/lib/video/types.ts
export type VideoProviderKey = 'self' | 'mux' | 'cloudflare' | 'embed';
export interface VideoSource {
  /** Resolve a browser-playable URL (signed for self-host). */
  resolvePlaybackUrl(lesson: { videoProvider: string; videoStorageUri: string }, expirySeconds?: number): Promise<string>;
}
```
- **v1 `SelfHostVideoSource`** wraps the existing `src/lib/storage` (`uploadFile` on ingest, `getSignedUrl` on playback). The DB only ever stores the opaque `videoStorageUri` (`gcs://…`/`minio://…`).
- A `resolveVideoSource(provider)` factory returns the right implementation; `mux`/`cloudflare`/`embed` implement the same interface later with **no change to the player or course pages**.

---

## 5. System back office — authoring (`src/app/system`)

New section **"Video Courses"** in the system area, modeled on the existing **Standard Manual** upload (`src/app/api/system/manual/route.ts`: `verifySystemAdminCookie` → validate → `uploadFile` → DB row [→ optional BullMQ job] → poll).

### 5.1 Upload screen — `src/app/system/video-courses/`
- List existing global video courses (title, duration, #questions, #orgs offering, created) + **"Upload video course"**.
- Upload form fields: **title, description, category, objectives, duration (auto-filled from probe if available), passing score, allowed attempts**, **video file**, **quiz file (CSV or JSON)**, plus **"Download CSV sample" / "Download JSON sample"** links.
- POST → `src/app/api/system/video-courses/route.ts`:
  1. `verifySystemAdminCookie()`; reject if absent (404 in prod, like manual).
  2. Validate the video (mime `video/*`, size ≤ cap — see §8) and parse+validate the quiz file (§6).
  3. `uploadFile(key, buffer, mimeType)` → `videoStorageUri`.
  4. Transaction: create global `Course(type=video, isGlobal=true, createdBy=SYSTEM_USER_ID, status=published)` → `Lesson(order=1, content="", videoProvider='self', videoStorageUri, videoDurationSeconds)` → `Quiz(passingScore, allowedAttempts)` → `Question[]` from the parsed file.
  5. Return the created course; the screen refreshes.
- Edit/replace/unpublish a global course later (out of v1 scope beyond create + delete).

---

## 6. Quiz file schema (CSV + JSON) + validation

Maps onto `Question` (`text`, `options` Json, `correctAnswer` String, `explanation` String?, `order`).

### 6.1 CSV
Header row required. Columns:
```
question, option_a, option_b, option_c, option_d, correct_answer, explanation
```
- `correct_answer` = a letter `A|B|C|D` (case-insensitive) **or** the exact option text. Empty trailing options allowed (2–4 options). `explanation` optional. One question per row; `order` = row index.

### 6.2 JSON
```json
{
  "passingScore": 80,
  "allowedAttempts": 2,
  "questions": [
    { "text": "What does PHI stand for?",
      "options": ["Protected Health Information", "Private Hospital Index", "Patient Health Insurance"],
      "correctAnswer": "Protected Health Information",
      "explanation": "PHI = Protected Health Information." }
  ]
}
```
- `correctAnswer` must match one of `options` (or be a 0-based index / letter — accept and normalize). `passingScore`/`allowedAttempts` here override the form values when present.

### 6.3 Validation (shared `src/lib/video/quiz-import.ts`)
- ≥1 question; each question: non-empty text, 2–4 options, a resolvable `correctAnswer`. Normalize the stored `correctAnswer` to the **option text** (matching how the existing learner flow grades — `submitQuizAttempt` compares selected text vs `Question.correctAnswer`). Return structured per-row errors surfaced in the upload UI before any DB write.
- **Sample templates** served from `src/app/system/video-courses/samples/` (or an API route) — a 3-question CSV and the equivalent JSON.

---

## 7. Org admin & staff experience

### 7.1 Discovery & adoption (org admin)
- **Dashboard home** — a separate **"Available Courses"** table (~5 random global video courses) above/below "My Courses" (home is already migrated; this is an additive table). Row action: **Offer to my org** → creates `OrgCourseOffering`.
- **Courses page → tabbed**: tab A = the org's own text courses (existing `CoursesListClient`); tab B = **video / "Available" courses** (paginated global catalog + adoption state). Two course types live in separate tabs, never mixed.
- Optional per-org **custom title/description/intro** editable on the offering.

### 7.2 Assignment (org admin → staff)
- From an offered video course, **assign specific staff** → reuse the existing enrollment path (`enrollUsers(courseId, staffEntries)` / `AssignUserCourseModal` just migrated) to create per-staff `Enrollment`s (with `assignedByAdminId`, optional due date). Same scoring/attestation/certificate flow as text courses.

### 7.3 Staff playback + quiz
- Staff see assigned video courses in their training list (reuse `CoursePreview` / training detail).
- The course **player reuses `learn/[id]`**: for a `video` lesson, the content area renders a **`VideoPlayer`** (HTML5 `<video>` fed by `VideoSource.resolvePlaybackUrl`) instead of article/slide HTML — "presented just like the notes/slide."
- **Playback progress**: the player periodically POSTs position/watched-% → updates `Enrollment.videoPositionSeconds` + `progress` (debounced, e.g. every ~10s and on pause/seek/ended) via a server action / `/api/enrollments/[id]/video-progress`. Resume from `videoPositionSeconds`.
- **Watch gate**: quiz unlocks at **≥95% watched** (reuses the existing quiz gate UI in `learn/[id]`).
- **Quiz + completion**: existing `submitQuizAttempt` grades vs `Question.correctAnswer`. **Pass (`score ≥ Quiz.passingScore`) → completion + `Certificate`** (reuse existing attestation/issue path). **Fail → existing retry/retake flow** (`requestCourseRetry` / `assignRetake`, honoring `allowedAttempts`). No new scoring/cert code.

### 7.4 Reporting
- Free: training dashboards, staff profiles, completion metrics, and certificate lists already aggregate over `Course`/`Enrollment`, so video results appear in the **same consolidated reports**. Where useful, label/segment by `Course.type` ("Custom Training" vs "System Training").

---

## 8. Large-file upload (v1)

- **Direct upload, size-capped.** Cap configurable (default ~500 MB; env e.g. `MAX_VIDEO_UPLOAD_BYTES`). Set Next route body/size limits accordingly. Accept common web-playable types (`video/mp4`, `video/webm`).
- Caveat: existing `uploadFile(key, buffer, …)` buffers the whole file in memory — acceptable at the v1 cap, flagged for the resumable/streaming upgrade. The `VideoSource`/upload boundary is the seam where **resumable upload + Mux/Cloudflare ingest** slot in later.

---

## 9. Server actions / API surface (new)

- `src/app/actions/video-course.ts` (system-admin guarded): `createVideoCourse(input)`, `listGlobalVideoCourses()`, `deleteVideoCourse(id)`.
- `src/app/api/system/video-courses/route.ts` — multipart POST (video + quiz file + metadata).
- `src/app/actions/offering.ts` (org-admin guarded): `offerCourseToOrg(courseId, overrides?)`, `listAvailableVideoCourses()` (global catalog + this org's offering state), `updateOffering(id, overrides)`, `withdrawOffering(id)`.
- Assignment: **reuse** `enrollUsers`. Playback URL: `getVideoPlaybackUrl(lessonId)` (enrollment-guarded) → `VideoSource`. Progress: `saveVideoProgress(enrollmentId, positionSeconds, watchedPct)`.
- `src/lib/video/{types,self-host,index,quiz-import}.ts`.

---

## 10. Out of scope (v1) / future
- Mux/Cloudflare/Vimeo/external-embed providers (interface ready), resumable/chunked upload, server-side transcoding/HLS, captions/subtitles, in-app quiz authoring UI (v1 = file upload), editing a published global course's video/quiz beyond delete+re-upload, PHI/compliance scanning of stored video.

## 11. Risks / notes
- **Keep text flow green**: `getCourses`/the creation wizard must continue to ignore global video courses (filter `type='text'` / `isGlobal=false` where they list "my courses"). Verify no existing query accidentally surfaces global rows.
- **Grading parity**: store `Question.correctAnswer` as **option text** so `submitQuizAttempt` grades video quizzes identically to text quizzes.
- **System-admin auth** is cookie-based (no NextAuth session) — system actions/routes guard via `verifySystemAdminCookie()`, distinct from org-admin (`resolveSession`).
- Cap + memory: direct upload buffers in memory at the cap (see §8).
