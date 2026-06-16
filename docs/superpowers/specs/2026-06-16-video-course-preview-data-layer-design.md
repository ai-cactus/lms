# Video Course Flow — Data Layer Design

**Date:** 2026-06-16
**Branch:** `feat/video-course-designs`
**Scope:** Data layer for the full prebuilt-video-course flow (Prisma schema + migration + types + read/write data functions) **plus the system back-office upload interface** (§9.1) so every required video-course field is captured. All *org-facing* visual/UI work (preview page, learn page, assign screen, listings) is a later phase. We lock the schema once here so the design phases that follow don't trigger repeat migrations.

---

## 1. The flow this supports

Org-admin journey for adopting a prebuilt (global) video course:

1. **Dashboard / Courses page** — "Choose a Prebuilt Course" list of available global video courses. The old **"Offered Video Courses"** tab/section is **removed**; adopted courses blend into **My Courses**.
2. **Enroll now** on a prebuilt card → runs the existing `offerCourseToOrg` (offer functionality holds) → navigates to course details `/dashboard/training/courses/[id]`.
3. **Course Details** (existing `TrainingDetails`) — stats + Preview + Assign.
4. **Preview** → `/dashboard/training/courses/[id]/preview` (the preview page: trailer video, overview, what you'll learn, chapters, quiz).
5. **View Course** → `/learn/[id]` — video player + module/lecture sidebar + quiz (Notes/Slides tabs hidden for now).
6. **Assigning & Publish** — assign staff, set training-schedule (access) date, renewal cycle, and reminders.
7. **Publish** → enroll the assigned workers → success modal.

## 2. Guiding priority

Compliance and **easy data export** — organization-wide and per single staff member — for every video course an org adopts. The model below keeps per-org adoption (`OrgCourseOffering`) and per-staff records (`Enrollment` with status/score/completion/attestation/certificate) as first-class, queryable rows so reporting/export is a straightforward query, not a schema problem.

## 3. Adoption model — DECIDED: shared offering

- Keep today's behavior: **Enroll now = `offerCourseToOrg`** → creates an `OrgCourseOffering` pointing at the shared global `Course`. Staff `Enrollment`s reference the global course directly.
- **No cloning, no per-org content editing** in this phase. "Expand with org-specific modules" (clone / hybrid) is explicitly deferred.
- Org-level cosmetic overrides remain via the existing `OrgCourseOffering.customTitle/customDescription/customIntro`.

## 4. What already exists (reused, not re-added)

| Element | Existing source |
|---|---|
| Title / subtitle | `Course.title` / `Course.description` |
| Approved by | `Course.approvedBy` |
| Total Duration | `Course.duration` |
| Pass mark, quiz | `Quiz` + `Question` |
| Last Updated | `Course.updatedAt` |
| What You'll Learn | `Course.objectives` (`String[]`) |
| Org adoption | `OrgCourseOffering` (+ custom overrides) |
| Per-staff records | `Enrollment` (status, score, completedAt, attestedAt) + `Certificate` |
| Assign staff | `enrollUsers` (extended below) |

## 5. Schema changes (additive, backward-compatible)

### 5.1 Course content — Chapters → Lectures, course-level quiz, preview, overview, skill level

```prisma
enum SkillLevel {            // course's targeted experience level — NOT quiz difficulty
  beginner
  intermediate
  advanced
}

model Course {
  // … all existing fields unchanged …
  overview                    String?            // long-form Course Overview (distinct from short `description`)
  skillLevel                  SkillLevel?        // experience level the course targets
  previewVideoStorageUri      String?            // MinIO URI of the trailer/preview clip
  previewVideoDurationSeconds Int?
  modules                     CourseModule[]
  quiz                        Quiz?              // optional course-level quiz (new)
  assignments                 CourseAssignment[] // new (Section 5.2)
}

model CourseModule {          // a "Chapter" in the UI; also feeds the "Included Modules" list
  id        String   @id @default(uuid())
  courseId  String
  title     String
  order     Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  course    Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lessons   Lesson[]          // the lectures
  @@index([courseId])
}

model Lesson {
  // … all existing fields unchanged …
  moduleId String?            // null ⇒ ungrouped (text courses / legacy single-lesson video courses)
  module   CourseModule? @relation(fields: [moduleId], references: [id], onDelete: SetNull)
  @@index([moduleId])
}

model Quiz {
  lessonId String? @unique    // was: String @unique → now optional
  courseId String? @unique    // new: course-level quiz
  // … all existing fields unchanged …
  lesson   Lesson?  @relation(fields: [lessonId], references: [id], onDelete: Cascade) // made optional
  course   Course?  @relation(fields: [courseId], references: [id], onDelete: Cascade)
}
```

- A **lecture IS a `Lesson`** (`videoStorageUri` + `moduleId` set) — reuses all existing lesson video plumbing and the per-lesson video proxy `/api/video/[lessonId]`.
- **Quiz XOR ownership** (lesson OR course) enforced in app code. Existing per-lesson quizzes keep working.
- Durations (per-lecture / per-chapter / total) are **computed**, not stored.

### 5.2 Assignment & Publish — per-batch settings

A `CourseAssignment` represents one "Assign & Publish" action (a batch of workers assigned together) and holds the shared schedule / renewal / reminders. Workers assigned at a different time form a different batch with their own settings.

```prisma
enum RenewalCycle {
  none
  monthly
  quarterly
  semiannual
  annual
}

model CourseAssignment {
  id                String      @id @default(uuid())
  organizationId    String
  courseId          String
  assignedByAdminId String
  scheduleAt        DateTime?               // Training Schedule: workers gain access on this date
  renewalCycle      RenewalCycle @default(none)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  course            Course       @relation(fields: [courseId], references: [id], onDelete: Cascade)
  reminders         AssignmentReminder[]
  enrollments       Enrollment[]
  @@index([organizationId])
  @@index([courseId])
}

model AssignmentReminder {       // "Add reminder" → 0..n per batch
  id           String  @id @default(uuid())
  assignmentId String
  offsetMinutes Int             // minutes before the anchor (scheduleAt) the email fires
  channel      String  @default("email")
  assignment   CourseAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  @@index([assignmentId])
}

model Enrollment {
  // … all existing fields unchanged …
  assignmentId String?
  accessAt     DateTime?          // denormalized from batch.scheduleAt for access gating
  assignment   CourseAssignment? @relation(fields: [assignmentId], references: [id], onDelete: SetNull)
  @@index([assignmentId])
}
```

Back-relations to add: `Organization.courseAssignments CourseAssignment[]`.

- **Renewal = record only.** We persist `renewalCycle`; the automation that re-creates enrollments at renewal time is a later task.
- **Reminders** are a child table (not JSON) so a future reminder-sending cron can query due reminders across orgs efficiently.
- `Enrollment.accessAt` is denormalized from the batch so access-gating checks stay cheap.

## 6. Backward compatibility & migration

- All new columns nullable / new relations optional / new enums additive → migration is purely additive.
- `Quiz.lessonId` widens from required to optional (safe; existing rows already set it).
- Existing text courses and legacy single-lesson video courses have `moduleId = null`; the read layer falls back to ungrouped `lessons` when a course has no `modules`.
- Existing enrollments have `assignmentId = null` (pre-batch); treated as "assigned immediately, no schedule/renewal."
- Optional backfill (follow-up, not blocking): wrap each legacy video course's single lesson in one default `CourseModule`.

## 7. Types (`src/types/course.ts`)

- Extend `CourseWithRelations` to include `modules → lessons (ordered, with quiz)` and course-level `quiz → questions`. New scalars are auto-picked by `Prisma.CourseGetPayload`.
- Add an `EnrollmentWithAssignment`/extend `EnrollmentWithRelations` to include `assignment → reminders` where the assign flow needs it.

## 8. Read side

- `getCourseById` → `include` `modules` (ordered, each with ordered `lessons` and lesson `quiz`), course-level `quiz` (with `questions`), preview fields. Keep ungrouped `lessons` for the legacy fallback.
- **My Courses / dashboard** (`getDashboardData`, courses page query) → union the org's own courses with its **adopted offered video courses** so adopted courses blend into "My Courses". Drop the separate offered listing.

## 9. Write side (data contract + system upload interface)

- **Create (system/back-office) data contract:** extend `CreateVideoCourseInput` + `/api/system/video-courses` to accept `overview`, `skillLevel`, a preview video (→ `previewVideoStorageUri` + probed `previewVideoDurationSeconds`), a list of **modules** each with ordered **lectures** (title, video, duration), and a single **course-level quiz**. `createVideoCourse` writes Course → CourseModule[] → Lesson[] (lectures) → course Quiz + Question[] in the existing `$transaction`. Legacy single-lesson path stays valid.
- **System upload interface (IN SCOPE — see §9.1):** `VideoCoursesClient.tsx` upload form is updated so all the data above is captured completely. Without this the new schema can't be populated.
- **Assign & Publish:** extend `enrollUsers` to, in one transaction: create a `CourseAssignment` (scheduleAt, renewalCycle, reminders[]) and create/link the workers' `Enrollment`s (`assignmentId`, `accessAt`). Returns the assignment + created enrollments for the success modal.
- The **Assigning & Publish screen UI** and the **org-facing tab/listing/preview/learn UI changes** remain deferred to the design phase.

### 9.1 System video-course upload interface (in scope)

The back-office upload form (`src/app/system/video-courses/VideoCoursesClient.tsx` + `/api/system/video-courses`) is extended to capture every field a video course's preview and player need. New/changed inputs:

- **Overview** — textarea (long-form, maps to `Course.overview`); existing short **Description** kept as the one-line subtitle.
- **Skill Level** — select (`beginner | intermediate | advanced` → `Course.skillLevel`).
- **Preview video** — its own file picker (separate from lecture videos), browser-probed duration → `previewVideoStorageUri` + `previewVideoDurationSeconds`.
- **Chapters & Lectures** — a repeatable builder: "Add chapter" (title) → within each, "Add lecture" (title + video file, browser-probed duration). Order is the array order. Replaces the current single-video input.
- **Quiz file (CSV/JSON)** — unchanged input, now attached at **course level**.
- Existing fields (category, passing score, allowed attempts, duration) kept; total `duration` may be auto-summed from lecture durations when left blank.

**Upload transport — two-step (recommended).** Because a course now carries many videos (preview + every lecture) and one multipart POST would blow past the nginx 512 MB body limit, switch to: (1) upload each video file individually (preview + each lecture) to a storage endpoint that streams to MinIO and returns its `storageUri` + probed duration; (2) submit a single JSON payload describing the course (overview, skillLevel, chapters → lectures with their `storageUri`s, quiz) to `createVideoCourse`. The existing single-multipart route is kept for the legacy single-video path or retired once the new flow lands. This is an implementation decision flagged for the plan; the alternative (one large multipart with raised limits) is noted but not recommended.

## 10. UI removals enabled here (data-side only)

- Remove the "Offered Video Courses" tab (`CoursesPageTabs`) and the dashboard `OfferedCoursesTable`. `listOfferedVideoCourses` becomes unused for listing (may be kept for internal counts). These deletions are UI; the only data-side requirement is that My-Courses reads now include adopted courses (Section 8).

## 11. Downstream impact to FLAG (audit during planning, not part of the schema change)

- Code assuming "one `Quiz` on one `Lesson`": enrollment progress/completion (`enrollment.ts`, learn flow), quiz grading (`submitQuizAttempt`, `QuizAttempt`), and the preview's pass-mark lookup must also consider the course-level quiz.
- Access gating: `scheduleAt`/`accessAt` in the future should gate worker access (relates to `EnrollmentStatus.locked`). Not wired in this phase.
- `enrollUsers` callers (`ShareCourseModal`, wizard `Step7Publish`) — signature gains optional assignment settings; keep them working with defaults.

## 12. Out of scope

- Per-org clone / hybrid adoption / org-specific content editing (deferred — shared model only).
- Renewal automation, reminder-sending job, access-gating enforcement.
- Org-facing visual/UI work (preview page, learn page, Assigning & Publish screen, success modal, tab-removal markup). NOTE: the **system back-office upload interface** is IN scope (§9.1).
- Stored/denormalized duration columns.

## 13. Open items for review

1. Model name `CourseModule` vs `CourseChapter` (note: existing generation pipeline already calls a `Lesson` a "module").
2. `SkillLevel` enum values `beginner | intermediate | advanced` sufficient?
3. `RenewalCycle` set (`none | monthly | quarterly | semiannual | annual`) — correct options?
4. Reminder anchor: `offsetMinutes` measured before `scheduleAt` (access date). Confirm the anchor, and whether `offsetMinutes` (vs a coarser unit) is the right granularity.
5. `AssignmentReminder` as a child table vs a JSON array on `CourseAssignment` (chosen: child table, for cron queryability).
6. Whether `Enrollment.accessAt` denormalization is wanted now or should be read through the batch.
