# Findings Register

**System:** Theraptly LMS (`lms2`) · **Audit date:** 2026-07-05 · **Branch audited:** `dev` @ `4f47527`

A flat, stable-ID list of every finding. Reference these IDs from tickets, PRs, and the other report tiers. Severity uses: **Critical** (exploitable data breach, compliance-blocking, or silent data loss), **High** (serious risk or scale-blocker), **Medium** (real but bounded), **Low** (hardening / hygiene).

Counts: **8 Critical · 24 High · 21 Medium · 14 Low** (deduplicated across the eleven audit passes).

---

## Critical

| ID | Title | Area | Evidence | Fix summary |
|----|-------|------|----------|-------------|
| **F-001** | No audit trail anywhere in the system | Compliance / Audit | `prisma/audit.prisma` holds only `AuditorPack` (a report artifact) and it is never written; no `AuditLog` model exists; sensitive reads/writes go only to ephemeral stdout | Add an append-only `AuditLog` (actor, org, action, entity, ip, ts) written from a central helper on every auth event, PHI/PII access, export/download, role & billing change. Fails HIPAA §164.312(b). |
| **F-002** | PHI-scan bypass on the primary course-creation flow | AI / PHI | `src/app/actions/course-ai-v4.6.ts:501-512` extracts uploaded document text and sends it to Vertex AI with **no `scanText` call**; only the Document Hub path (`documents.ts`) scans | Run the fail-closed `scanText` gate before any generation call on the wizard upload path. |
| **F-003** | PHI transmitted to Google pre-verification and raw PHI values persisted | AI / PHI | `src/lib/documents/phiScanner.ts:50,75` sends first 15k chars to Gemini to *detect* PHI; matched strings stored in `phi_reports.detected_entities` (`documents.ts:135`) | Use a local/deterministic detector (regex + NER) or a BAA-covered DLP endpoint; store entity **types/offsets**, never raw values; execute + verify GCP BAA. |
| **F-004** | No database or object-store backups | Infrastructure | No `pg_dump`/WAL/snapshot tooling anywhere (grep of scripts/db/docs/deploy); all data on one VM's bind mounts `/home/deploy/data/*` | Scheduled encrypted Postgres backup (PITR) + object-store replication off-host; documented, tested restore runbook. HIPAA §164.308(a)(7). |
| **F-005** | Background workers & cron only start on a human page-load | Infra / Jobs | Workers boot as import side-effects in `src/app/system/layout.tsx:47-71` (`force-dynamic`, system-admin-gated); no bootstrap in `src/instrumentation.ts` | After any restart, reminders/escalations, indexing, transcode, and sweeps silently never run until an admin opens `/system`. Move workers to an always-on process/service. |
| **F-006** | pgvector `embedding` column is invisible to Prisma → next migration drops it | Data | `manual_chunks.embedding vector(768)` added by raw SQL (`20260504100000_.../migration.sql:1`); absent from `prisma/category.prisma:42-44` | Model it as `Unsupported("vector(768)")` (or manage RAG store outside Prisma); mark as a protected column. A model-driven migration will `DROP` it today. |
| **F-007** | No DB-level tenant isolation; `Course`/`Enrollment` carry no `organizationId` | Data / Multi-tenancy | `course.prisma:28`, `enrollment.prisma:29` — org identity is transitive via `createdBy`/`user`; no RLS, no scoping middleware | 100% of tenant safety is per-query app code. Add `organizationId` + composite indexes, enforce Postgres RLS or a mandatory scoping layer in the new backend. |
| **F-008** | Google API key baked into the browser build | Infra / Secrets | `NEXT_PUBLIC_GEMINI_API_KEY` passed as a Docker build-arg (`Dockerfile:37,41`; `deploy-*.yml`); any `NEXT_PUBLIC_*` is world-readable | Currently unreferenced in `src/` so not bundled *today*, but the key is compiled into every image's env. Remove from all env/build files and rotate. |

---

## High

| ID | Title | Area | Evidence | Fix summary |
|----|-------|------|----------|-------------|
| **F-009** | Cross-tenant IDOR: `getStaffDetails` reads any user's profile + enrollments + quiz history | Security | `src/app/actions/staff.ts:11-46` — session check only, **no org scope** (sibling mutations all check org) | Assert `target.organizationId === session.user.organizationId` + admin role before returning. CWE-639. |
| **F-010** | Cross-tenant IDOR: `getEnrollmentQuizResult` leaks answer keys + PII for any enrollment | Security | `src/app/actions/staff.ts:257-355` — no org scope; returns `correctAnswer` for every question + worker identity | Same fix: assert org match + role. CWE-639/200. |
| **F-011** | `xlsx@0.18.5` parses attacker-supplied spreadsheets (Prototype Pollution + ReDoS) | Security / Deps | `package.json`; sinks `staff-csv.ts:162`, `onboarding/step4/page.tsx:91`, `auditor .../download/route.ts:148`. Fix (`>=0.20.2`) is **not on npm** | Migrate to SheetJS CDN build `^0.20.3` or `exceljs`; validate + parse in an isolated worker with a size cap. |
| **F-012** | MFA is not enforced on API routes or server actions | Auth | A session cookie with `mfaVerified=false` is minted at credential sign-in (`create-auth-instance.ts:120`); the only MFA gate is in `proxy.ts:116-125`, whose matcher excludes all business API routes & actions | A password-only session can call `/api/billing`, `/api/quiz`, actions, etc. Enforce `mfaEnabled → mfaVerified` in a shared `requireSession()` used everywhere. |
| **F-013** | Business API routes bypass the auth proxy entirely | Auth | `proxy.ts:153-161` matcher covers only page routes; every `/api/**` handler self-guards with an imperative `auth()` call | Any handler that forgets the check is fully open (opt-in security). Add a default-deny wrapper. |
| **F-014** | Stripe webhook returns 200 on handler error and has no event-id idempotency | Billing | `src/app/api/webhooks/stripe/route.ts:69-73` returns `{received:true}` on exception → Stripe never retries; no `event.id` dedup, no out-of-order guard | Add `ProcessedWebhookEvent(id)` dedup, compare event timestamps, return 5xx for retryable failures. |
| **F-015** | BullMQ workers run inside the Next.js web process | Perf / Architecture | `system/layout.tsx:47-71`, `api/auditor/export/start/route.ts:105`, `api/system/worker/route.ts:23`; `instances:2` in `ecosystem.config.js:43` | Central blocker to splitting web/worker; duplicate heavy consumers competing for the 4 GB heap. Extract to a standalone worker service. |
| **F-016** | Document parse + PHI scan + AI generation run synchronously in request handlers | Perf / AI | `documents.ts:31-53` (buffer + `pdf-parse`/`mammoth` + Vertex inline); `course-ai-v4.6.ts` awaits ~5 sequential Vertex calls via `after()`; `quiz/[id]/submit` grades via Vertex inline | Prime source of the 4 GB heap need and multi-minute request slots. Offload to queued jobs with client polling. |
| **F-017** | No upload size limit on the main document/wizard paths; whole file buffered in memory | Perf / AI | `documents.ts:31` and `course-ai-v4.6.ts:505` read `file.arrayBuffer()` with no cap; only the manual route caps (50 MB) | OOM/DoS on large uploads. Enforce a cap and stream to storage; parse from storage in a worker. |
| **F-018** | No rate limiting on expensive AI endpoints | Security / Cost | No `checkRateLimit` in `course-ai*.ts`, `quiz-ai.ts`, or `quiz/[id]/submit` (grep) | An authenticated user drives unbounded Vertex cost / DoS. Add per-user/org quotas + concurrency caps. |
| **F-019** | No HTTP security headers (CSP, HSTS, X-Frame-Options, nosniff) | Security | `next.config.ts` has no `headers()`; `lms2_nginx.conf` sets none | Clickjacking on the authenticated dashboard, no downgrade pinning, no CSP backstop for the rich-text surface. Add strict headers at Next or nginx. CWE-693/1021. |
| **F-020** | Failed reminder/escalation emails are marked "sent" and never retried | Email | `reminders/dispatch.ts:206-214` writes the dedup `ReminderLog(enrollment,stage)` row **before** sending; sender swallows transport errors (`email-sender.ts:148-160`) | A single SMTP failure permanently suppresses that compliance reminder. Record per-channel status; write dedup only after confirmed delivery; re-drive failures. |
| **F-021** | No email delivery-failure / bounce / suppression handling | Email | No `EmailMessage` model; fire-and-forget; every `email.ts` sender returns `{success:false}` without propagating | Add an `EmailMessage` table + retry queue + bounce ingestion. |
| **F-022** | Seat / plan limits never enforced after checkout | Billing | `staffMax` validated only at checkout against a free-text `organization.staffCount` (`checkout/route.ts:66-72`); nothing blocks inviting staff past the ceiling | Enforce seat limits at invite/accept against a live `count(users where role=worker)`. |
| **F-023** | hCaptcha / bot verification is not integrated despite being assumed present | Billing / Security | No `captcha`/`hcaptcha`/`turnstile` code or env anywhere; public POSTs rely on IP rate-limiting only | Add server-verified captcha on signup, request-demo, enterprise-inquiry, join flows. |
| **F-024** | Rate-limiter falls back to per-process in-memory state (fail-open across the fleet) | Security / Infra | `rate-limit.ts:13,78-91` uses a local `Map` on any Redis error; limits are per-instance | Multi-instance or Redis-down → limits multiply / reset. Fail-closed on limiter unavailability for auth paths; use a shared store with health gating. |
| **F-025** | No encryption at rest; document plaintext stored in the DB | Compliance / Infra | Plain `pgvector/pgvector:pg16` on host bind mount (`docker-compose.production.yml:65-72`); `DocumentVersion.content` holds extracted text (`document.prisma:25`); MinIO no SSE | Encrypted volumes / managed encrypted Postgres; MinIO SSE; drop or encrypt the `content` column; GCS CMEK. HIPAA §164.312(a)(2)(iv). |
| **F-026** | Broken Prisma singleton + no connection-pool tuning | Data / Perf | `db/index.ts:4-5` builds a new pool at import; `src/lib/prisma.ts:3-7` writes the global but never reads it back; `PrismaPg` gets no `max`/timeout | HMR/dev leaks pools; prod can exhaust Postgres connections. Collapse to one `globalForPrisma.prisma ?? new PrismaClient(...)`; set pool limits + pooled/direct URLs. |
| **F-027** | Missing FK indexes on hot paths + no pgvector KNN index | Data / Perf | `lessons.course_id` (`course.prisma:111`), `questions.quiz_id` (`quiz.prisma:21-35`) unindexed; `rag.ts:65` does `ORDER BY embedding <=> $q` with no `ivfflat`/`hnsw` index | Sequential scans that worsen with growth. Add the FK indexes + an HNSW vector index. |
| **F-028** | Admin dashboard loads all enrollments into memory; several unbounded list queries | Perf | `course.ts:346-355` `include: { enrollments: true }` no `take`, aggregated in JS; `queue/page.tsx:7`, `documents/page.tsx:14`, auditor org export all unbounded | Multi-MB result sets per render. Use `groupBy`/`_count`; paginate all growth-table reads. |
| **F-029** | Two conflicting deploy/runtime systems coexist (PM2 scripts + Docker/GHCR CI) | Infrastructure | `deploy*.sh` + `ecosystem.config.js` (paths `/home/homepc/lms2*`) vs GH Actions Docker (`/home/deploy/apps/*`); CI actively `pm2 delete`s | Ambiguous production source of truth, high operator-error risk. Pick one mechanism; immutable image tags + documented rollback. |
| **F-030** | No CI security gates; e2e never runs in CI; heavy pre-commit pushes devs to `--no-verify` | Testing / Compliance | `ci.yml` has lint/format/typecheck/test/build but no `npm audit`/SAST/secret-scan; `tests/e2e/**` excluded from vitest and not run; `.husky/pre-commit` runs full `test` + `build` | Add audit + secret-scan + Playwright jobs; move heavy checks to pre-push/CI; confirm branch protection. |
| **F-031** | Quiz scoring and multi-tenancy isolation have zero automated tests | Testing | No test for any `api/quiz/*` route (scoring at `submit/route.ts:154-165`); no cross-org negative test anywhere | The certification gate and the core tenant-safety property are unguarded. Add scoring unit/route tests + cross-org IDOR tests. |
| **F-032** | `QuizAttempt` schema cannot store attempt history | Data | `@@unique([enrollmentId, quizId])` (`quiz.prisma:49`) allows one row per enrollment/quiz, contradicting `attemptCount` / `allowedAttempts` / retry states | Attempts are overwritten. Drop/rework the unique to keep append-only history. |

---

## Medium

| ID | Title | Area | Evidence | Fix summary |
|----|-------|------|----------|-------------|
| **F-033** | NextAuth credential callback bypasses login rate-limiting | Auth | Throttle lives in the `authenticate` action (`auth.ts:41`), not in `authorize()` (`create-auth-instance.ts:61`); raw `POST /api/auth/callback/credentials` skips it | Move throttle into `authorize()` or in front of the handler; add per-account lockout. |
| **F-034** | `course.ts` / `lesson.ts` mutators lack a role check | Auth | `createCourse/updateCourse/publishCourse/deleteCourse` (`course.ts:224-334`) and all `lesson.ts` check only `session.user.id`, scope by `createdBy` | A worker session can create courses; soft privilege boundary. Assert `role==='admin'`; consider org-based ownership. |
| **F-035** | `AUTH_SECRET` vs `NEXTAUTH_SECRET` split-brain | Auth | `proxy.ts:48` decodes with `AUTH_SECRET`; encoder + all other decoders use `NEXTAUTH_SECRET` | Same value today, but divergence silently logs everyone out. Standardize on one var. |
| **F-036** | JWT callback is fail-open on DB errors | Auth | `create-auth-instance.ts:317-325` preserves the token if revalidation throws | Deleted/role-changed users retain access during a DB outage. Document / add a short grace window + revocation epoch. |
| **F-037** | No rate limit on password-reset request or `POST /api/invite/accept` | Auth | `auth.ts:250` (reset) and `invite/accept/route.ts:18` have no throttle | Email-bombing / enumeration timing; account-creation spam. Add IP limits consistent with signup. |
| **F-038** | Public certificate verification page leaks recipient email | Certificates | `verify-certificate/[id]/page.tsx:79` renders `profile?.fullName || user.email` to unauthenticated visitors | Never fall back to email on the public page; rate-limit + audit the lookup. |
| **F-039** | `score: enrollment.score || 100` truthiness bug on certificates | Certificates | `certificate.ts:92` — a legitimate score of 0 becomes 100 | Use `?? 100` and reconsider whether 0 should certify. |
| **F-040** | Portal-initiated Stripe pause never expires | Billing | Webhook reconciles `pauseEndsAt: existing ?? null` (`webhooks/stripe/route.ts:134`); null → `getPauseState` returns `paused` forever (`billing.ts:35-44`) | Default a portal-originated pause to `now + MAX_PAUSE_MONTHS`. |
| **F-041** | `stripe` default export can be `null` | Billing | `stripe.ts:37-39` non-null-asserts a possibly-null client; `constructEvent` throws a raw TypeError if `STRIPE_SECRET_KEY` missing at import | Use the lazy `getStripeClient()` everywhere. |
| **F-042** | No central env validation at boot | Infra | No zod/envalid startup schema; every service reads `process.env` lazily with `||` fallbacks; auth secrets, SMTP, Redis, DATABASE_URL unvalidated | Missing/typo'd secrets surface at runtime or degrade silently. Add a fail-fast boot schema per service. |
| **F-043** | nginx is bypassed by the Cloudflare tunnel | Infra | `cloudflared_config.yml:12-16` routes hostnames straight to `localhost:3000/3001`; nginx `server_name lms.theraptly.com` ≠ prod host `training.theraptly.com` | nginx body-size limits, real-IP, timeouts, and (future) security headers never apply on the live path. One consistent ingress. |
| **F-044** | `minio/minio:latest` (and other floating tags) unpinned | Infra | `docker-compose.*.yml` use `minio/minio:latest` | Non-reproducible builds; surprise breaking upgrades on `docker compose pull`. Pin digests. |
| **F-045** | Reminder sweep is O(enrollments) with per-enrollment N+1 recipient queries | Perf | `reminders/sweep.ts:47` loops due enrollments; `recipients.ts:60` `user.findMany` per enrollment; sequential email awaits | Wall-clock scales linearly, can exceed the 25-min lock. Batch-resolve recipients; bounded-concurrency fan-out. |
| **F-046** | No caching layer anywhere | Perf | No `unstable_cache`/Redis GET-SET/`s-maxage` (grep); dashboard aggregations + RAG embeddings recomputed every request | Redis-cache expensive aggregations + embeddings; tag-based invalidation. |
| **F-047** | All video/media bytes proxied through the Next server | Perf / Scale | `api/video/[lessonId]/route.ts:79-99`, `preview-video/route.ts:77` stream storage bytes through the app | Hard scaling ceiling for video-heavy orgs. Serve via CDN / public signed URLs. |
| **F-048** | Verbose internal error returned to client from document proxy | Security | `documents/[versionId]/preview/route.ts:57` returns `Error proxying document: ${e.message}` | Leaks storage host/URL fragments. Return generic message; log details server-side. CWE-209. |
| **F-049** | Vertex safety filters all `BLOCK_NONE` + unescaped prompt-injection surface | AI / Security | `ai-client.ts:113-118`; untrusted `{{DOCUMENT_TEXT}}`/`{{RAG_CONTEXT}}` interpolated raw (`prompts-v4.6.ts:625-651`); PHI prompt also interpolates untrusted text | A crafted document can steer generation or make the PHI scan report `hasPHI:false`. Delimit/escape input; reconsider `BLOCK_NONE`. |
| **F-050** | `String.replace(string, string)` prompt substitution corrupts on `$&`, `` $` ``, `$'`, `$$` | AI | `prompts-v4.6.ts:625-672` | Document text containing `$`-sequences injects/corrupts the prompt. Use a function replacer or `split/join`. |
| **F-051** | Generated courses auto-publish with no review gate even when stages degrade | AI / Content | Stages B–E are non-fatal and only emit warning strings (`course-ai-v4.6.ts:886-897`); `createFullCourse` sets `status:'published'` (`course.ts:694`) | Low-quality/missing-quiz courses go live. Require review / block publish when warnings exist. |
| **F-052** | Org-scoped category slug is globally unique | Data | `course_categories.slug @unique` (`category.prisma:9`) but categories can be org-scoped | Two orgs can't share a custom slug. Use `@@unique([organizationId, slug])`. |
| **F-053** | No unique on `enrollments (user_id, course_id)` | Data | `enrollment.prisma:57` only indexes, no unique | Duplicate active enrollments possible. Add a partial unique on active statuses. |
| **F-054** | Removed staff keep an active account; no retention/disposal policy | Compliance | `staff.ts:357-405` only nulls `organizationId`; no purge jobs for tokens/invites/`detected_entities`; no user self-delete | Define retention windows + scheduled purge + a deactivation/deletion path. SOC 2 C1.2. |
| **F-055** | Transitive dependency CVEs unaddressed; no audit gate | Deps | `npm audit`: `@babel/core`, `postcss<8.5.10` (via next), `ajv`, `brace-expansion`, `uuid`, `quill@2.0.3` XSS (mitigated by DOMPurify) | Run `npm audit fix` for the safe set; evaluate forced bumps; add `npm audit`/Dependabot to CI. |

---

## Low

| ID | Title | Area | Evidence |
|----|-------|------|----------|
| **F-056** | Weak system-admin auth: shared static password, non-constant-time `===`, no per-actor identity | Auth | `system-admin.ts:47`; grants cross-org super-admin incl. `deleteUserWithRelations` |
| **F-057** | Email address leaked in forced-reset redirect URL | Auth | `proxy.ts:105` puts `email` in the query string |
| **F-058** | Inconsistent bcrypt cost factors (10 vs 12) | Auth | `auth.ts:200,313,357` vs `create-auth-instance.ts:178` |
| **F-059** | Password reset / forced reset does not invalidate existing sessions | Auth | No `sessionVersion`/`passwordChangedAt` claim checked in the jwt callback |
| **F-060** | Sensitive info committed in `.claude/agent-memory/*` (dev DB password, GCP SA email, test creds, defect notes) | Secrets | Git-tracked memory files |
| **F-061** | Two parallel job-polling implementations with divergent guarantees | Frontend | Robust `use-job-status.ts` (1 consumer) vs ad-hoc `ExportJobsProvider.tsx:174` (`setInterval 1500`, localStorage) |
| **F-062** | Global toasts effectively broken outside the admin area | Frontend | `<Toaster>` mounted only at `dashboard/(main)/layout.tsx:81`; worker/auth/onboarding/system `toast()` calls no-op |
| **F-063** | 84% of components are client components (114/135); heavy libs statically imported | Frontend / Perf | recharts, react-pdf, xlsx not code-split; `learn/[id]/page.tsx` 1118 lines |
| **F-064** | No `error.tsx` boundaries; only one `loading.tsx` | Frontend | 0 error boundaries; server components do live DB I/O |
| **F-065** | Design-system drift: 78 files with raw hex in `className`, 26 with inline styles; two token sources | Frontend | `globals.css` `@theme` vs `src/style/design-tokens.ts` |
| **F-066** | No timeout on embeddings AI call | AI | `ai-client.ts:244` — `generateBatchEmbeddings` has no AbortController |
| **F-067** | No log shipping/retention/correlation IDs; `serializeError` may spread sensitive props | Observability | `logger.ts:74-77` stdout only; `:31-35` spreads all own error props |
| **F-068** | God files correlate with untested high-churn areas | Quality | `course.ts` 1,337 · `email.ts` 1,148 · `learn/[id]/page.tsx` 1,118 · `course-ai-v4.6.ts` 996 |
| **F-069** | Stale docs mislead compliance review | Docs | `docs/phi-redactor.md` documents old fail-open + API-key auth (both contradict current code); `docs/system-architecture.md` still says "CSS Modules" and single-process |

---

## Verified-good (record for the rebuild — do not regress)

- The **12 prior security findings** in `docs/hack-check.md` are all genuinely fixed on `dev` (invite org/role from session, staff same-org mutations, CSPRNG tokens, org-code rate-limit, auditor download isolation).
- **PHI currently routes only through BAA-eligible Vertex AI** (OAuth service account); the consumer Gemini SDK (`@google/generative-ai`, non-BAA endpoint) is a declared dependency but **unreferenced in `src/`**. Keep it that way.
- **Parameterized SQL** everywhere (`$queryRaw`/`$executeRawUnsafe` all parameterized); **DOMPurify** on every `dangerouslySetInnerHTML` sink; **signed-URL** media proxies (no SSRF from user input); **Stripe signature verification**; secure cookie flags + separate admin/worker realms.
- **Zero `console.*`** outside the logger; **`maskEmail`** helper exists; strong unit coverage of `lib/` pure logic (553 cases).
- **CSS-Module migration is genuinely complete** (0 `.module.css`).
