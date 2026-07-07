# 04 — Data & Storage Specification

**Owners:** `api` + `worker` (only these tiers touch the database and object storage). **Prerequisite:** [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md). This document is detailed enough to recreate the persistence layer exactly, or to reuse the existing database in place.

## 1. Database engine & client

- **PostgreSQL 16** with the **pgvector** extension (`CREATE EXTENSION IF NOT EXISTS "vector"`).
- **Prisma 7** with the `prisma-client` generator (TypeScript, output `generated/prisma`) and the `@prisma/adapter-pg` driver over `pg` 8.
- **Single pooled client** (fix F-026): one `PrismaService` using `globalForPrisma.prisma ?? new PrismaClient({ adapter })`; configure `PrismaPg` with `max`, `idleTimeoutMillis`, and a statement timeout; use a **pooled `DATABASE_URL`** (PgBouncer/`connection_limit`) for the app and a **direct URL** for migrations.
- Conventions to preserve if reusing the DB: every model `@@map`s to a snake_case plural table; every column `@map`s to snake_case (established by migration `20260622135211_rename_tables_columms`). Timestamps are `TIMESTAMP(3)`; `updatedAt` is **application-managed** (`@updatedAt`), not a DB trigger — a non-Prisma backend must replicate this.

## 2. Domain model (entities to recreate)

Grouped by domain. Every PK is `String @id @default(uuid())` unless noted. Tenant field = `organizationId` where present.

**Auth** — `User` (email unique, bcrypt `password`, `role UserRole`, `organizationId?` `onDelete:Restrict`, `managerId?` self-relation, `authProvider`, `emailVerified`, `mfaEnabled`, `mfaVerifiedAt?`, `passwordResetRequired`); `Profile` (**shares PK with User**, FK `id`→`users.id` Cascade, name parts, `jobTitle`, `avatarUrl`, `hasSeenAuditorWelcome`); `Invite` (`token` unique, `organizationId` Cascade, `role`, `status InviteStatus`, `expiresAt`, `invitedBy?`); `VerificationToken` (**no surrogate PK**, `@@unique([identifier, token])`, `type`, `expires`, and doubles as pending-signup store: `password?`, `firstName?`, `lastName?`, `role?`); `MfaFactor` (`userId` Cascade, `secret` AES-GCM, `verified`); `MfaRecoveryCode` (`userId` Cascade, `codeHash`, `usedAt?`).

**Organization/Billing** — `Organization` (`slug`/`joinCode`/`stripeCustomerId` unique; compliance flags `isHipaaCompliant`, `hasAuditorAccess`, `requireMfa`, `inactivityTimeoutMinutes`=15, `timezone`; `additionalBusinessTypes String[]`=`[]`, `programServices String[]`=`[]`); `Subscription` (1:1 org, `stripeSubscriptionId` unique, plan/cycle/status enums, period bounds, `cancelAtPeriodEnd`, `pausedAt?`, `pauseEndsAt?`); `Invoice` (`stripeInvoiceId` unique, `amountPaid Int` cents, `currency`='usd', PDF URLs — **add `updatedAt`**, F-016 register).

**Course** — `Course` (**no `organizationId` today — add it, F-007**; `createdBy` Restrict, `isGlobal`, `status CourseStatus`, `type CourseType`, `skillLevel`, `category?` free-text + `categoryId?`, approval fields, video fields, six JSON columns `rawCourseJson/rawQuizJson/rawArticleMeta/rawJudgeJson/rawSlidesJson` + `rawArticleMarkdown`, `objectives String[]`=`[]`); `CourseModule`; `Lesson` (`courseId` Cascade **add index F-027**, `moduleId?` SetNull, `content`, `slideContent?`, video fields, `mediaStatus MediaStatus`=ready); `CourseArtifact` (`@@unique([courseId,type,version])`); `CourseVersion` (links course↔DocumentVersion — **add indexes F-027**); `CourseAssignment` (`organizationId` Cascade, `scheduleAt`, `dueAt`, `dueWindowDays`, `remindersEnabled`, `renewalCycle`); `AssignmentReminderStage` (`@@unique([assignmentId,stage])`, `channels String[]`=`["email","in_app"]`).

**Enrollment/Certificate** — `Enrollment` (**no `organizationId` today — add it, F-007**; `userId` Cascade, `courseId` Restrict, `status EnrollmentStatus`, `progress Int`=0, `videoPositionSeconds?`, `score?`, attestation fields, `retakeOf String?` — **make it a self-relation FK, F-cross**, `assignmentId?` SetNull, `dueAt?`; **add `@@unique([userId,courseId])` partial on active, F-053**); `Certificate` (1:1 enrollment, denormalized `userId`/`courseId`, `score`, `pdfStoragePath?` — **add `revokedAt`/`verificationCode`**); `ReminderLog` (`@@unique([enrollmentId,stage])`); `ReminderNudge` (`@@unique([enrollmentId,kind])`, `lastSentAt`, `count`).

**Quiz** — `Quiz` (`lessonId?`/`courseId?` both unique+nullable — **add `CHECK num_nonnulls(lesson_id,course_id)=1`**; `passingScore`=70, `allowedAttempts Int?`=1, `timeLimit?`); `Question` (`quizId` Cascade **add index F-027**, `options Json?`, `correctAnswer`, `type`, `evidence Json?`, `explanation?`); `QuizAttempt` (`answers Json`, `score`, `attemptCount`=1 — **drop/rework `@@unique([enrollmentId,quizId])` to allow attempt history, F-032**).

**Category/RAG** — `CourseCategory` (`slug` unique — **change to `@@unique([organizationId,slug])`, F-052**, `isSystem`, `organizationId?` Cascade); `StandardManual` (`isActive`, `chunkCount`); `ManualChunk` (+ the **`embedding vector(768)`** column — see §4); `ManualChunkCategory` (composite PK `@@id([chunkId,categoryId])` — **add reverse index on `categoryId`**).

**Document** — `Document` (`userId` Cascade); `DocumentVersion` (`documentId` Cascade **add index F-027**, `version`, `storagePath`, `hash` SHA, `content?` — **encrypt or drop, F-025**); `PhiReport` (1:1 version, `hasPHI`, `detectedEntities Json?` — **store types/offsets not raw values, F-003**); `MappingEvidence` (`documentVersionId` Cascade **add index**).

**Notification** — `Notification` (`userId` Cascade, `type` free-text, `metadata Json?`, good indexes `[userId,createdAt]`/`[userId,isRead]`); `NotificationPreference` (`@@unique([userId,type]`).

**Job/Media** — `Job` (`userId?`, `type`, `status JobStatus`, `payload Json?`, `result Json?`, indexes on `userId`/`status`).

**Audit/Offering** — `AuditorPack` (orphaned/unused — either wire it or drop it, F-cross); `OrgCourseOffering` (`@@unique([organizationId,courseId])`).

**New models to add for the rebuild:**
- **`AuditLog`** (append-only) — `id, actorId?, actorRole, action, targetType, targetId?, organizationId?, ip?, userAgent?, metadata Json?, createdAt`; indexes `[organizationId, createdAt]`, `[actorId, createdAt]`; **no UPDATE/DELETE grants** to the app role. *(F-001.)*
- **`ProcessedWebhookEvent`** — `stripeEventId @unique, type, processedAt`. *(F-014.)*
- **`EmailMessage`** — `id, recipient, template, status, providerMessageId?, attempts, lastError?, sentAt?, createdAt`. *(F-020, F-021.)*

## 3. Enums (recreate exactly)

`UserRole{admin,worker}` · `InviteStatus{pending,accepted,expired}` · `SubscriptionPlan{starter,professional,enterprise}` · `SubscriptionBillingCycle{monthly,quarterly,yearly}` · `SubscriptionStatus{active,past_due,canceled,trialing}` · `CourseStatus{draft,published,inactive}` · `CourseType{text,video}` · `SkillLevel{beginner,intermediate,advanced}` · `RenewalCycle{none,monthly,quarterly,semiannual,annual}` · `EnrollmentStatus{enrolled,assigned,in_progress,lessons_complete,completed,attested,locked,failed,retry_requested}` · `ReminderStage{INITIAL_LAUNCH,FRIENDLY_REMINDER,URGENT_REMINDER,DAY_OF_DEADLINE,GRACE_SOFT_ESCALATION,HARD_ESCALATION}` · `ReminderNudgeKind{WORKER_RETAKE,ADMIN_REASSIGN}` · `JobStatus{queued,processing,completed,failed}` · `MediaStatus{processing,ready,failed}`.

Consider promoting free-text `type` columns (`Notification.type`, `Job.type`, `Question.type`, `CourseArtifact.type`) to enums/lookup tables (F-015 register).

## 4. pgvector / RAG store (handle carefully — F-006)

- `manual_chunks.embedding` is `vector(768)` (from `text-embedding-004`), added by **raw SQL**, and **absent from the Prisma model** today. A model-driven migration will `DROP` it. Fix: declare it in the model as `Unsupported("vector(768)")` (read/write still via `$queryRaw`), **or** manage the RAG store entirely outside Prisma. Mark it a protected column in the migration policy.
- **Add a KNN index** (missing today, F-027): `CREATE INDEX ON manual_chunks USING hnsw (embedding vector_cosine_ops);` — the retrieval query `ORDER BY embedding <=> $q` sequential-scans without it.
- Chunking: 1500 chars / 200 overlap; embeddings batched (≤250/call; today 100). Similarity filtered to the active `StandardManual`.

## 5. JSON & array column shapes (for a non-Prisma reimplementation)

- `courses.raw_course_json / raw_quiz_json / raw_slides_json / raw_judge_json / raw_article_meta` — raw AI-pipeline outputs; schemas defined by the Zod files `prompt-schemas*.ts` (doc 05). `raw_article_markdown` is TEXT.
- `questions.options Json?` — option array (strings or `{text,...}` in v4.6); `questions.evidence Json?` — supporting evidence.
- `quiz_attempts.answers Json` — user answers map.
- `notifications.metadata Json?`, `jobs.payload/result Json?` — free-form per-type.
- `phi_reports.detected_entities Json?` — **redesign to store entity type + offset, never the raw PHI string (F-003)**.
- Array defaults: `organizations.additional_business_types`/`program_services`=`[]`, `courses.objectives`=`[]`, `assignment_reminder_stages.channels`=`["email","in_app"]`, `reminder_logs.channels`=`[]`.

## 6. Integrity, isolation & indexes

- **onDelete policy (preserve exactly):** Cascade on org→(invites, subscription, invoices, categories, assignments, offerings), user→(profile, mfa, enrollments, documents, notifications, prefs, certificates), course→(modules, lessons, artifacts, versions, offerings, assignments, quiz), enrollment→(quizAttempts, certificate, reminderLogs, reminderNudges), documentVersion→(phiReport, mappingEvidence). Restrict on User→Org, Course→creator, Certificate→Course. SetNull on User.manager, Course.categoryId, Course.approvedBy, Lesson.moduleId, Enrollment.assignmentId.
- **Add `organizationId` to `Course` and `Enrollment`** (backfill from creator/user), with composite indexes for the common `where org + status` reads. *(F-007.)*
- **Row-Level Security (recommended second layer):** enable Postgres RLS on tenant tables keyed to a per-request `SET app.current_org`; the app guard remains primary, RLS is defense-in-depth so a missed `where` can't leak. *(F-007, F-009/F-010.)*
- **Add the missing indexes** in §2 (F-027) and the KNN index (§4).

## 7. Object storage

- **Primary: GCS** via `@google-cloud/storage`; auth by base64 service-account JSON decoded in-memory (`GCS_KEY_BASE64`) in prod/staging, ADC in dev. **Fallback: MinIO/S3** (dev + resilience). URIs are `gcs://bucket/key` or `minio://bucket/key`; storage selection is GCS-first.
- **Signed URLs:** browser uploads **direct to storage** via `api`-minted V4 resumable POST (GCS) / presigned PUT (MinIO); reads via short-lived (15-min) signed GET or a `media/*` 302 redirect. **No bytes transit the app** (F-047).
- **Encryption at rest:** enable GCS CMEK and MinIO SSE; store nothing sensitive unencrypted (F-025).
- **Lifecycle:** 365-day delete rule (per `docs/gcs-setup.md`); CORS restricted to the app origins.
- Buckets: documents, course artifacts/videos, certificates, manuals — least-privilege service account.

## 8. Backups & retention (F-004, F-054)

- **Postgres:** automated encrypted backups + PITR (WAL archiving) off the app host; tested restore runbook.
- **Object storage:** versioning + cross-location replication.
- **Redis:** persistence + off-host snapshot (AOF alone is not a backup).
- **Retention/disposal:** scheduled purge of expired `VerificationToken`, expired `Invite`, stale `Job` rows, and (policy-defined) `DocumentVersion.content`/`phi_reports`; documented retention windows (HIPAA audit logs ≥6 years).

## 9. Migration reuse

25 existing migrations can be carried forward as-is if reusing the DB (mind the vector column, §4, and the 0-byte no-op `20260518015115`). If starting clean, regenerate from the corrected schema (with `organizationId` on Course/Enrollment, the new indexes, the `AuditLog`/`ProcessedWebhookEvent`/`EmailMessage` tables, and the `Unsupported("vector(768)")` column). Run migrations as a **one-shot deploy job**, not per-container-start and not duplicated in a shell script (F-029/register).
