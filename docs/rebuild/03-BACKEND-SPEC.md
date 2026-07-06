# 03 — Backend Service Specification (API Contract)

**Service:** `api` (NestJS, Node 20 LTS, TypeScript). **Prerequisite:** [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md). Data model in [`04-DATA-STORAGE-SPEC.md`](./04-DATA-STORAGE-SPEC.md); async work in [`05-AI-PIPELINE-WORKERS-SPEC.md`](./05-AI-PIPELINE-WORKERS-SPEC.md); auth/compliance detail in [`07-SECURITY-COMPLIANCE-SPEC.md`](./07-SECURITY-COMPLIANCE-SPEC.md).

This document is the **contract**: the backend must expose these resources so the retained Next.js frontend keeps working. It is derived from the current 50 route handlers + 31 server-action modules (the complete surface the frontend depends on today).

---

## 1. Module layout (NestJS)

```
api/src/
  main.ts                      # bootstrap, global pipes/guards/interceptors, helmet, env validation
  common/
    guards/                    # AuthGuard, RolesGuard, OrgScopeGuard, SystemAdminGuard, StripeSignatureGuard
    interceptors/              # AuditLogInterceptor, ErrorEnvelopeInterceptor, CorrelationIdInterceptor
    pipes/                     # ZodValidationPipe (global)
    decorators/               # @CurrentUser, @Roles, @Public, @Realm('admin'|'worker'), @Audit(action)
  config/                      # zod-validated env schema, loaded at boot (F-042)
  prisma/                      # PrismaService (single client, pooled)  (F-026)
  redis/                       # Redis clients: bullmq, rate-limit, sessions
  modules/
    auth/                      # login (admin+worker), MFA, email-verify, password reset, invites, join-code, OAuth
    organizations/             # org CRUD, settings, compliance doc, org-code
    staff/                     # staff list/detail/manager/remove/invite  (fix F-009/F-010 here)
    courses/                   # course CRUD, lessons, publish, mapping
    generation/               # AI course/quiz generation jobs (enqueue only)
    catalog/                   # global video courses + org offerings
    enrollments/               # enroll, progress, retake, attestation
    quizzes/                   # attempts: start/save/submit (grading enqueues explanations)
    certificates/              # issue, list, stream, public verify
    billing/                   # subscriptions, checkout, portal, payment-methods, invoices, webhook
    documents/                 # upload-url, finalize, list, delete, preview-url
    notifications/             # notifications + preferences
    reports/                   # auditor export jobs + downloads
    media/                     # signed-URL/redirect for video/cert/doc  (F-047)
    jobs/                      # unified job-status resource
    admin/                     # system-admin: users, manual, worker/cron control
    audit/                     # AuditLog write helper + query (compliance)
    health/                    # /health, /ready
```

Business logic ports from the corresponding `src/lib/*` and `src/app/actions/*` files (doc 01 §2).

## 2. Conventions

- **Base path:** `/api/v1`. **Content-Type:** `application/json` except the Stripe webhook (raw body) and signed-URL uploads (direct to storage, not through `api`).
- **Error envelope (all errors):** `{ "error": { "code": "STRING_CODE", "message": "human message", "details"?: {...} } }` with the correct HTTP status. Internal exceptions are caught by `ErrorEnvelopeInterceptor` and never leak stack/host info (F-048).
- **Status codes:** 200/201 success, 400 validation, 401 unauthenticated, 403 forbidden (role/org/mfa), 404, 409 conflict, 413 payload too large, 422 unprocessable (business rule), 429 rate-limited, 5xx server. Standardize the billing gate on **403** (today it's 402 in one place, 403 in another — F-cross).
- **Pagination:** cursor-based `{ items, nextCursor }` for all growth tables (enrollments, audit logs, notifications, documents, jobs, invoices). *(Resolves F-028.)*
- **Validation:** every body/query has a Zod schema; the global pipe rejects unknown/invalid input (`400`).
- **Auth headers/cookies:** see §3.

## 3. Authentication & session model

Preserve the semantics the frontend depends on (doc 02 §3) while moving issuance to `api`.

- **Two realms**, admin and worker, simultaneously valid. Session is a signed token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the app domain: `__Secure-admin.session-token` / `__Secure-worker.session-token`.
- **Claims** (unchanged contract): `id`, `role`, `organizationId?`, `passwordResetRequired`, `mfaEnabled`, `mfaVerified`, `sessionId` (stable UUID), `authProvider`, `email`, `name`, `iat`. Idle expiry = `INACTIVITY_TIMEOUT_MINUTES` (sliding).
- **Global `AuthGuard`** validates the cookie, loads the session context, and **re-checks role/org/mfa against the DB** (replacing the per-decode revalidation in today's jwt callback). Endpoints opt out only with `@Public()`. *(Resolves F-013.)*
- **MFA enforcement in the guard:** if `mfaEnabled && !mfaVerified`, reject every non-MFA endpoint with `403 MFA_REQUIRED`. *(Resolves F-012.)*
- **`OrgScopeGuard` + `requireSameOrg`:** any endpoint that takes a resource id resolves the resource's `organizationId` and rejects on mismatch, by default. *(Resolves F-009, F-010, F-007 at the app layer.)*
- **Rate limiting** in a guard/interceptor, Redis-backed, **fail-closed** on auth + AI endpoints (F-024), applied to the credential path itself (not just the UI action — F-033), with per-account lockout.
- **Session validation for the frontend:** expose `GET /auth/session` returning the current session context (the `web` middleware and server components call this instead of decoding JWTs locally — doc 02 §3). This removes the `AUTH_SECRET`/`NEXTAUTH_SECRET` split-brain (F-035) because only `api` signs/verifies tokens.
- Portable pieces reused: `mfa.ts`, `mfa-challenge.ts`, `session-mfa.ts`, `password-policy.ts`, `system-auth.ts` (replace shared-password system-admin with real accounts + MFA over time — F-056).

---

## 4. API contract by module

Guard legend: **S**=authenticated session · **A**=admin role · **W**=worker · **O**=org-scoped · **Own**=resource owner · **Sys**=system-admin · **Sig**=Stripe signature · **Pub**=public. Every non-`Pub` endpoint also passes the MFA guard.

### 4.1 auth
| Method | Path | Guard | Purpose | Notes / resolves |
|--------|------|-------|---------|------------------|
| POST | `/auth/login` | Pub | Credential login (realm resolved by email→role) | rate-limit + per-account lockout (F-033); returns MFA challenge if `mfaEnabled` |
| POST | `/auth/worker/login` | Pub | Worker login | |
| POST | `/auth/logout` | S | Clear session cookie(s) | |
| POST | `/auth/signup` | Pub | Create pending signup (stored as verification token) | rate-limit; email verification |
| POST | `/auth/verify-email` | Pub | Consume verification token → create User+Profile | POST (defeats scanner prefetch) |
| POST | `/auth/resend-verification` | Pub | Resend verify email | rate-limit |
| POST | `/auth/password-reset/request` | Pub | Send reset link | **add rate-limit (F-037)** |
| POST | `/auth/password-reset/confirm` | Pub | Consume reset token | invalidate existing sessions (F-059) |
| POST | `/auth/password/force-reset` | S | Forced reset (current pw required) | clears `passwordResetRequired` |
| POST | `/auth/mfa/challenge/send` | Pub+challenge | Send login MFA OTP | rate-limit by IP+user |
| POST | `/auth/mfa/challenge/verify` | Pub+challenge | Verify TOTP/OTP/recovery → mark session MFA-verified | |
| POST | `/auth/mfa/setup` | S | Begin TOTP enrollment | |
| POST | `/auth/mfa/setup/verify` | S | Confirm enrollment → return recovery codes | |
| POST | `/auth/mfa/disable` | S | Disable MFA | |
| POST | `/auth/mfa/recovery-codes` | S | Regenerate recovery codes | |
| GET | `/auth/session` | S | Current session context for the frontend | replaces local JWT decode (F-035) |
| GET/POST | `/auth/oauth/microsoft/*` | Pub | Entra ID OAuth (JIT user+profile, invite auto-accept) | OAuth users: enforce app-side MFA or verify conditional access (F-012) |

### 4.2 organizations & staff
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| POST | `/organizations` | S | Create org (onboarding) → caller becomes admin |
| GET | `/organizations/:id` | S,A,O | Org detail/settings |
| PATCH | `/organizations/:id` | S,A,O | Update settings (HIPAA flags, timezone, MFA-required, inactivity timeout) |
| POST | `/organizations/:id/compliance-document` | S,A,O | Upload compliance doc (via signed URL + finalize) |
| GET | `/organizations/:id/org-code` | S,A,O | Get/rotate join code |
| POST | `/organizations/join-code/verify` | Pub | Verify join code (rate-limited) |
| POST | `/organizations/:id/join` | S,W | Worker joins org by code |
| GET | `/organizations/:id/staff` | S,A,O | Staff list (paginated) |
| GET | `/organizations/:id/staff/:uid` | **S,A,O** | Staff detail — **must org-scope (F-009)** |
| PATCH | `/organizations/:id/staff/:uid` | S,A,O | Update staff details |
| POST | `/organizations/:id/staff/:uid/manager` | S,A,O | Set manager |
| DELETE | `/organizations/:id/staff/:uid` | S,A,O | Remove staff (detach) → consider full deprovision (F-054) |
| POST | `/organizations/:id/invites` | S,A,O | Bulk invite workers (seat-limit enforced against live count — F-022) |
| DELETE | `/organizations/:id/invites/:token` | S,A,O | Revoke invite |
| POST | `/organizations/:id/invites/:token/resend` | S,A,O | Resend invite |
| POST | `/invites/accept` | Pub | Accept invite → create User+Profile (rate-limit F-037) |
| GET | `/organizations/:id/staff/:uid/enrollments/:eid/quiz-result` | **S,A,O** | Quiz result detail — **must org-scope (F-010)** |
| POST | `/organizations/:id/staff/:uid/activity-report` | S,A,O | Generate + email staff activity PDF (enqueue) |

### 4.3 courses, generation, catalog
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| GET | `/courses` | S,A,O | List org + global courses (paginated) |
| POST | `/courses` | **S,A,O** | Create course — **add role check (F-034)**; consider org-owned not creator-owned |
| GET | `/courses/:id` | S,A,O | Course detail (admin/org/global) |
| PATCH | `/courses/:id` | S,A,O | Update |
| POST | `/courses/:id/publish` | S,A,O | Publish (block/flag if generation warnings — F-051) |
| DELETE | `/courses/:id` | S,A,O | Delete |
| POST | `/courses/:id/lessons` … | S,A,O | Lesson CRUD + reorder |
| GET | `/courses/:id/content` | S,S | Full player payload (lessons+quiz+enrollment) — the `/learn` shape; answer key only to admins |
| POST | `/courses/:id/mapping` | S,A,O | Save compliance mapping evidence |
| POST | `/generation-jobs` | S,A,O | Enqueue course/quiz generation from `{documentVersionId|storageUri, config}` → `{jobId}` (rate-limited F-018; PHI-gated F-002) |
| GET | `/generation-jobs/:id` | S,A,O | Poll generation status/result |
| POST | `/generation-jobs/quiz-question` | S,A,O | Single-question generation (rate-limited) |
| POST | `/documents/:id/analyze` | S,A,O | Enqueue document metadata analysis |
| GET | `/catalog/video-courses` | S,A,O | Available global video courses |
| GET/POST/PATCH/DELETE | `/catalog/offerings` | S,A,O | Org course offerings (offer/update/withdraw) |

### 4.4 enrollments & quizzes
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| POST | `/enrollments` | S,A,O | Bulk enroll workers + notify + email |
| GET | `/enrollments/:id` | S,Own\|A,O | Enrollment with results |
| PATCH | `/enrollments/:id/progress` | S,Own | Update lesson progress (forward-only; zod 0–100) |
| POST | `/enrollments/:id/attest` | S,Own | Attestation (signature) → issue certificate |
| POST | `/enrollments/:id/retake` | S,Own\|A | Request/assign retake |
| POST | `/quizzes/:id/attempts/start` | S,Own | Start/resume/retake (attempt-limit txn) |
| PATCH | `/quizzes/:id/attempts/current` | S,Own | Save in-progress answers |
| POST | `/quizzes/:id/attempts/submit` | S,Own | Grade (pass/fail); **AI explanations enqueued, not inline (F-016)**; on lock → notify admins + email |

**Grading contract (`submit`)** — req `{ enrollmentId, answers: [{questionId, selectedAnswer}], timeTaken? }`; res `{ score, passed, correctCount, totalQuestions, attemptsUsed, allowedAttempts, courseName, questions:[{id,text,options,selectedAnswer,correctAnswer,explanation}] }`. Scoring logic gets unit + route tests (F-031).

### 4.5 certificates & media
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| POST | `/certificates` | S | Issue (idempotent; on completed/attested; require real name; fix `score ?? 100` — F-039) |
| GET | `/certificates` | S | List (worker own / admin org) |
| GET | `/certificates/:id/download` | S,Own\|A,O | Signed-URL/redirect to PDF (F-047) |
| GET | `/public/certificates/:code/verify` | Pub | Verify — **expose name/course/org/date only, never email (F-038)**; rate-limit + audit |
| GET | `/media/video/:lessonId` | S | Signed-URL/redirect to video (creator/enrolled/global) — no byte proxy (F-047) |
| GET | `/media/documents/:versionId` | S,Own | Signed-URL to document preview |

### 4.6 billing (Stripe)
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| GET | `/billing/overview` | S,A,O | Plan, usage, default PM, recent invoices |
| GET | `/billing/invoices` | S,A,O | Paginated invoices |
| GET | `/billing/payment-methods` | S,A,O | List cards |
| DELETE | `/billing/payment-methods/:id` | S,A,O | Detach (verify PM.customer) |
| POST | `/billing/payment-methods/:id/default` | S,A,O | Set default |
| POST | `/billing/portal` | S,A,O | Stripe billing portal session |
| POST | `/billing/subscription/checkout` | S,A,O | New checkout OR in-place plan swap (validate zod, not casts) |
| POST | `/billing/subscription/cancel` | S,A,O | Cancel at period end (409 if scheduled) |
| POST | `/billing/subscription/pause` | S,A,O | Pause 1–3 months |
| POST | `/billing/subscription/resume` | S,A,O | Resume |
| POST | `/billing/contact-enterprise` | S,A,O | Enterprise inquiry email |
| POST | `/webhooks/stripe` | **Sig** | Events → dedup by `event.id`, txn apply, **5xx on retryable failure (F-014)** |

**Seat enforcement (F-022):** `POST /organizations/:id/invites` and `/invites/accept` check the live `count(users where role=worker AND organizationId=:id)` against the plan `staffMax`; reject at the ceiling.

### 4.7 documents, notifications, reports, jobs
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| POST | `/documents/upload-url` | S | Mint signed direct-to-storage upload URL (type+size validated; **enforce size cap F-017**) |
| POST | `/documents/finalize` | S | Register uploaded object → enqueue parse+PHI-scan job (F-002) |
| GET | `/documents` | S,Own | List (paginated) |
| PATCH | `/documents/:id` | S,Own | Rename |
| DELETE | `/documents/:id` | S,Own | Delete (+ storage object) |
| GET | `/notifications` | S | List (cursor-paginated) |
| GET | `/notifications/unread-count` | S | Badge count |
| POST | `/notifications/:id/read` · `/read-all` · DELETE `/:id` · `/clear` | S | Mutations (soft-delete for audit — F-054) |
| GET/PUT | `/notifications/preferences` | S | Per-type opt-out |
| POST | `/reports/exports` | S,A,O,billing | Enqueue auditor export (scope/date-range) → `{jobId}` |
| GET | `/reports/exports/:id` | S,A,O | Poll status |
| GET | `/reports/exports/:id/download` | S,A,O,billing | Download (pdf/csv/docx); tenant-isolated; **audit-logged (F-001)** |
| GET | `/jobs/:id` | S,Own\|A,O | Unified job status (generation, export, indexing, transcode) |

### 4.8 admin (system-admin) & health
| Method | Path | Guard | Purpose |
|--------|------|-------|---------|
| POST | `/admin/session` | Pub→Sys | System-admin login (move to real accounts+MFA — F-056) |
| GET | `/admin/users` · `/admin/users/:id` | Sys | Cross-org user management |
| GET | `/admin/users/:id/delete-preview` · DELETE `/admin/users/:id` | Sys | Cascade delete |
| POST | `/admin/manuals` | Sys | Upload standard manual (signed URL) → enqueue indexer |
| POST | `/admin/video-courses` … | Sys | Global video course CRUD + upload URLs |
| POST | `/admin/reminders/run` | Sys | Trigger reminder sweep (dry-run supported) — but **cron owns the schedule in `worker`, not this route (F-005)** |
| GET | `/health` | Pub | Liveness (DB+Redis) |
| GET | `/ready` | Pub | Readiness |

---

## 5. What the frontend loses and must replace

Every one of these Next-internal mechanisms disappears at the split and becomes an `api` call (doc 02 catalogs the per-page work):

- **26 direct-Prisma server-component pages** → `GET` endpoints above.
- **31 server-action modules** → the controllers above. Strip all `revalidatePath` calls (no meaning outside Next — F-cross).
- **In-process streaming media proxies** → `media/*` signed-URL endpoints.
- **In-process file uploads** → `documents/upload-url` + direct-to-storage (already the pattern for video).
- **NextAuth cookie/JWT encode-decode in 6 places** (`proxy.ts`, `verify-mfa.ts`, `mfa/verify`) → `api` owns tokens; `web` calls `GET /auth/session`.

## 6. Testing requirements for the backend (F-031)

- Unit: quiz scoring (boundary at `passingScore`, 0-question guard, rounding), billing plan/seat logic, reminder ladder, PHI-scan fail-closed.
- Integration: every mutation route with a mocked Stripe/Vertex/storage; **cross-org negative tests** proving user A cannot read/write org B's staff, courses, enrollments, certificates, exports (guards the IDOR class permanently).
- Contract: the grading, billing-overview, and course-content shapes the frontend consumes.
- CI: run unit + integration + Playwright e2e on every PR; add `npm audit`/secret-scan (F-030).
