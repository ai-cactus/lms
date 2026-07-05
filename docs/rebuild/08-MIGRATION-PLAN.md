# 08 — Migration Plan (Monolith → Frontend + Backend + Worker)

**Prerequisite:** all prior rebuild docs. This is the phased, low-risk sequence to reach the target without a big-bang cutover. It is designed so the app keeps working at every step and value lands early.

## Principles

- **No big bang.** Stand up the new services alongside the monolith; move surface area incrementally; keep one deployable shippable at all times.
- **Compliance-blocking fixes first**, in the current monolith, before/while the split proceeds — they are cheap and can't wait for the rewrite (see the [analysis roadmap](../analysis/SYSTEM-ANALYSIS-REPORT.md#11-prioritized-remediation-roadmap)).
- **Strangler-fig for the API:** the retained frontend routes stay put; each area's data source flips from direct-Prisma/server-action to an HTTP call to `api`, one area at a time.
- **Extract the worker first** — it's the highest-value, lowest-coupling move and unblocks scaling + reliability immediately.

## Phase 0 — Stop the bleeding (in the monolith, ~days)

Do these now, no architecture change required. Each closes a live risk.
- Fix the two IDORs: org-scope `getStaffDetails` + `getEnrollmentQuizResult` (F-009, F-010).
- Add the PHI `scanText` gate to the course-wizard upload path (F-002).
- Remove/rotate `NEXT_PUBLIC_GEMINI_API_KEY`; purge secrets/defect notes from `.claude/agent-memory/*` (F-008, F-060).
- Stripe webhook: dedup by `event.id` + return 5xx on retryable failure (F-014).
- Add security headers + AI-endpoint rate limits (F-019, F-018).
- Protect the pgvector column with `Unsupported("vector(768)")` before the next migration (F-006).

**Exit:** the acute security/PHI/data-integrity risks are closed; the app is safe to keep running while the split proceeds.

## Phase 1 — Extract the worker service (~1–2 weeks)

The workers already exist as BullMQ code; the change is *where they run*.
1. Create the `worker` deployable (NestJS standalone or a thin bootstrap) importing the existing queue/worker/`reminders`/`ai` libraries.
2. Register all workers **and the cron schedulers** at service boot; remove the boot-from-`/system-layout` and boot-from-route side effects (F-005, F-015).
3. Point `api`/monolith to **enqueue only**; the worker consumes.
4. Add graceful shutdown (close workers on SIGTERM), a DLQ, and queue-depth alerts.
5. Move email sends into an `email-dispatch` queue backed by `EmailMessage` with retry (F-020, F-021).

**Exit:** background jobs and compliance reminders run independently of web traffic; the worker scales on its own; the biggest reliability + scale risk is gone. *(This alone resolves F-005, F-015 and de-risks F-020.)*

## Phase 2 — Stand up the backend API skeleton (~1–2 weeks)

1. Scaffold `api` (NestJS): global `AuthGuard` + `OrgScopeGuard` + `RolesGuard` (default-deny), `ZodValidationPipe`, `AuditLogInterceptor`, `ErrorEnvelopeInterceptor`, `PrismaService` (single pooled client — F-026), env validation at boot (F-042).
2. Move token issuance/validation to `api`; expose `GET /auth/session`; migrate the auth flows first (login, MFA, verify, invite) — they're mostly portable `src/lib` code.
3. Land the compliance foundations here: the append-only `AuditLog` (F-001), MFA-in-guard (F-012), default-deny routing (F-013), `requireSameOrg` (F-007 app layer).
4. Add the `ProcessedWebhookEvent` table + move the Stripe webhook to `api`.

**Exit:** `api` exists with auth + audit + guards; the monolith can start delegating.

## Phase 3 — Strangle the API, area by area (~4–8 weeks)

For each route group, move its data source from direct-Prisma/server-action to the `api` HTTP client (doc 02 §2). Recommended order (easy → hard):
1. **Course player + billing tabs** — already `fetch`-based; only re-point the base URL. Fast win.
2. **Quizzes + enrollments + certificates** — well-shaped, zod-validated; add the missing scoring/tenancy tests as you go (F-031).
3. **Notifications, documents, reports (exports)** — job-oriented; slot into `jobs/` + `media/` signed-URL endpoints (F-047).
4. **Admin dashboard pages (26 direct-Prisma)** — the most work: replace SSR Prisma queries with `api` fetches; use `groupBy`/`_count` + pagination on the backend (F-028).
5. **Onboarding, system-admin** — last; system-admin auth hardening (F-056) lands here.

During each cutover: strip `revalidatePath`, add the `error.tsx`/`loading.tsx` boundaries, consolidate the job poller, move `<Toaster>` to root (F-061, F-062, F-064).

**Exit:** the frontend holds no Prisma/storage/queue/Stripe/AI access; all data flows through `api`.

## Phase 4 — Move heavy work off the request path (overlaps Phase 3)

1. Document parse + PHI scan → `phi-scan`/`content-generation` queues; uploads go direct-to-storage via signed URLs with enforced size caps (F-016, F-017).
2. Course generation → `content-generation` queue with the PHI gate + publish-review gate (F-002, F-051); quiz-explanation AI → job (F-016).
3. Report generation → `report-export` queue; media via `media/*` signed URLs / CDN (F-047).

**Exit:** no multi-minute or memory-heavy work on the request path; the 4 GB heap requirement disappears.

## Phase 5 — Infrastructure hardening (overlaps Phases 1–4)

1. Split into three deployables with immutable image tags; retire the PM2 path (F-029); migrations as a one-shot job.
2. Private network for `api`/`worker`/stores; single enforced ingress with headers + limits; internal mTLS (F-043, F-019, F-025).
3. Managed encrypted Postgres/Redis + backups + tested restore (F-004); GCS CMEK / MinIO SSE (F-025).
4. Secrets manager + rotation; remove all secrets from VCS (F-060).
5. Observability: shipped logs + correlation IDs, APM, uptime/queue/backup alerts, IR runbook (F-067, doc 06 §7).
6. CI: integration + e2e + `npm audit` + secret-scan gating PRs (F-030).

**Exit:** the target infrastructure in doc 06; HIPAA/SOC 2 technical controls in place.

## Phase 6 — Data-model & dependency cleanup (rolling)

- Add `organizationId` to `Course`/`Enrollment` + backfill + RLS (F-007); the missing indexes + HNSW vector index (F-027); `QuizAttempt` history rework (F-032); org-scoped category slug + enrollment unique (F-052, F-053).
- Migrate off `xlsx@0.18.5`; run `npm audit fix`; track Quill fix (F-011, F-055).
- Redesign `phi_reports` to store types/offsets (F-003); drop/encrypt `DocumentVersion.content` (F-025).
- Design-system token adoption; god-file decomposition; correct stale docs (F-065, F-068, F-069).

## Sequencing at a glance

```
Phase 0 (days)      ▓▓ acute fixes in monolith
Phase 1 (1–2 wk)      ▓▓▓ extract worker            ← biggest reliability/scale win
Phase 2 (1–2 wk)        ▓▓▓ api skeleton + auth + audit + guards
Phase 3 (4–8 wk)          ▓▓▓▓▓▓▓ strangle API area by area
Phase 4 (overlap)           ▓▓▓▓ heavy work → queues
Phase 5 (overlap)         ▓▓▓▓▓ infra hardening + compliance
Phase 6 (rolling)              ▓▓▓▓▓ data-model & dep cleanup
```

## Validation gates between phases

- After each area cutover (Phase 3): the same UI must pass its existing e2e/QA journey against the new `api` path; cross-org negative tests must pass.
- Before claiming HIPAA/SOC 2 readiness: audit log populated for all events in doc 07 §4; encryption-at-rest verified; a restore drill completed; BAAs executed; the compliance status table in doc 07 §9 all-green.
- No phase is "done" while its automated tests are red (per project testing discipline).
