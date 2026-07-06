# 01 — Target Architecture & Backend-Stack Decision

**Prerequisite reading:** [`00-OVERVIEW.md`](./00-OVERVIEW.md). This document fixes the architecture the other specs build on.

## 1. The three services

| Service | Runtime | Responsibility | Trust tier | Scaling |
|---------|---------|----------------|-----------|---------|
| **Frontend (`web`)** | Next.js 16 (Node) | SSR + client UI, session cookies, calls the backend over HTTP. Holds **no** DB/AI/storage credentials and never touches PHI. | Public | Stateless, horizontal |
| **Backend (`api`)** | NestJS (Node/TS) | All business logic, Prisma/DB access, PHI handling, Stripe, auth issuance, audit logging, enqueues jobs, mints signed storage URLs. | Private | Stateless (except DB), horizontal |
| **Worker (`worker`)** | NestJS standalone / BullMQ (Node/TS) | Always-on. AI generation, PHI scan, document/manual indexing, video transcode, reminder & video sweeps (cron), report exports. Native binaries: `ffmpeg`, `poppler-utils`. | Private | Horizontal by queue |

Backing services (shared, private): **PostgreSQL 16 + pgvector** (encrypted, backed up), **Redis** (BullMQ + rate-limit + session/MFA state), **object storage** (GCS primary + MinIO/S3 fallback).

**Why worker is separate from api even though both are NestJS:** the worker must be always-on and independently scalable (a 20-minute video transcode must never share a request-handler's lifecycle or compete for its memory), and it is the only tier that needs `ffmpeg`/`poppler` in its image. Splitting them keeps the api image slim and lets you scale transcode capacity without scaling the API. They share the same codebase/monorepo and the same Prisma client and libraries; they differ only in entrypoint (HTTP server vs. queue consumers). *(Resolves F-005, F-015.)*

## 2. Backend-stack decision

**Chosen: NestJS (Node 20 LTS, TypeScript) + BullMQ worker in the same stack.**

### The deciding factor: reuse economics

The current backend logic is already ~40,000 lines of TypeScript that is *mostly framework-agnostic*. The security audit and discovery passes confirmed these modules are portable with minimal change:

- **Prisma schema + client** — moves as-is (doc 04).
- **`src/lib` pure logic** — `mfa.ts`, `mfa-challenge.ts`, `session-mfa.ts`, `password-policy.ts`, `rate-limit.ts`, `system-auth.ts`, `billing.ts`, `billing-plans.ts`, `stripe.ts`, `email.ts` (19 templates), the entire `reminders/` engine, `storage/` (GCS+MinIO providers), `ai-client.ts`, `rag.ts`, `phiScanner.ts`, `file-parser.ts`, `sanitize.ts`, `logger.ts`, `certificate-generator.tsx`, `audit-reports/`.
- **`src/app/actions/*`** — the 31 RPC modules are the de-facto service layer; their bodies become NestJS service methods.

A TypeScript backend ports all of this. A different language (Python/Go) would **rewrite every line** of it, re-validate against the Prisma schema, and re-test — for no functional gain.

### Why NestJS specifically (not bare Express/Fastify)

The single biggest architectural defect today is **opt-in, per-handler authorization** (F-012, F-013): every route re-implements `auth()` checks and any forgotten check is a hole — which is exactly how the two IDORs (F-009, F-010) happened. NestJS directly fixes this class of bug with first-class primitives:

- **Guards** — one `AuthGuard` + `OrgScopeGuard` + `RolesGuard` applied globally = default-deny. No endpoint is reachable without passing them. *(Resolves F-012, F-013.)*
- **Interceptors** — one audit-logging interceptor at the boundary writes the append-only `AuditLog` for every mutating/PHI-access request. *(Resolves F-001.)*
- **Pipes** — global `ZodValidationPipe` makes validation mandatory, not per-route discretion (fixes the hand-rolled-cast inconsistency).
- **Modules + DI** — imposes the separation of concerns the god-files (F-068) lack.
- **`@nestjs/bullmq`** — first-class queue integration for the worker service.

Fastify/Express would work but leave you hand-building all of the above — re-creating the same opt-in trap.

### Alternatives considered

| Option | Verdict | Why not |
|--------|---------|---------|
| **NestJS (TS)** | ✅ **Chosen** | Maximum reuse; framework-enforced guards/interceptors fix the root-cause authz pattern; same-stack worker. |
| Fastify/Express (TS) | Viable runner-up | Same reuse, but you re-build guards/validation/DI by hand — re-introducing the opt-in-auth risk. Choose this only if the team has strong Fastify preference and will enforce a global auth middleware discipline. |
| Python / FastAPI | Rejected | Full rewrite of 40k LOC of business logic + a second ORM (SQLAlchemy/SQLModel) modelling the same schema; loses Zod/Prisma reuse. Justified only if the team is Python-first and TS is a liability. |
| Go | Rejected | Best raw performance and smallest footprint, but the largest rewrite and the weakest ecosystem fit for this Prisma/Stripe/Vertex/PDF-heavy workload. |

> **If the team overrides to a non-TS stack:** docs 03–07 are written to be stack-neutral at the contract level (endpoints, payloads, models, controls). Only the "port `src/lib/X` as-is" notes become "reimplement `src/lib/X`." The API contract, data model, queue topology, and compliance controls are unchanged.

## 3. Service boundaries & what moves where

| Today (monolith) | Target service |
|------------------|----------------|
| 26 server-component pages doing direct Prisma | `web` renders; data via `api` HTTP calls |
| 31 `'use server'` action modules | `api` service methods (controllers + services) |
| 50 `/api/**` route handlers | `api` controllers (the natural template — see doc 03) |
| NextAuth dual-realm + `proxy.ts` | `api` issues sessions; `web` middleware validates via `api` (doc 02 §3) |
| Stripe calls + webhook | `api` (webhook stays a raw-body endpoint on `api`) |
| Vertex/Gemini + RAG | `worker` (generation) and `api` (only cheap synchronous reads if any) |
| BullMQ workers in-process | `worker` service |
| `after()` course-gen pipeline | `worker` queue job |
| nodemailer sends | `api` enqueues → `worker` sends (with delivery tracking) |
| MinIO/GCS access | `api` mints signed URLs; browser uploads direct-to-storage; `worker` reads from storage |
| Local `os.tmpdir()` job scratch | `worker` local disk (co-located binaries) |

## 4. Request flows (target)

**Read (e.g. admin dashboard):** browser → `web` (SSR) → `api GET /orgs/:id/dashboard` (guard: session+admin+org) → Prisma aggregate → JSON → SSR render. *No Prisma in `web`.*

**Mutation with audit (e.g. remove staff):** browser → `web` → `api POST /orgs/:id/staff/:uid/remove` → guards pass → service executes in a transaction → **audit interceptor writes `AuditLog`** → response. *(F-001)*

**Async generation (course wizard):** browser uploads document **direct to storage** via an `api`-minted signed URL → `web` → `api POST /generation-jobs {storageUri, config}` → `api` **enqueues** and returns `{jobId}` → `worker` runs PHI-scan gate → generation pipeline → writes `Job.result` → `web` polls `api GET /generation-jobs/:id`. *(F-002, F-016, F-017)*

**Billing webhook (Stripe → api):** Stripe → `api POST /webhooks/stripe` (raw body, signature verified) → dedup by `event.id` → apply in a transaction → return **200 only on success, 5xx on retryable failure**. *(F-014)*

**Media (video/certificate/doc):** browser → `api GET /media/...` → `api` returns a short-lived signed URL / 302 redirect to storage (or CDN) — **bytes do not transit the app**. *(F-047)*

## 5. Cross-cutting standards (enforced by all services)

- **Auth:** default-deny global guards; MFA enforced in the guard for `mfaEnabled` users on every endpoint (doc 03 §3, doc 07 §3).
- **Tenant isolation:** every resource access passes `requireSameOrg`; consider Postgres RLS as a second layer (doc 04 §6, doc 07 §2).
- **Validation:** global Zod pipe; every request body/query has a schema.
- **Errors:** one envelope `{ error: { code, message, details? } }` with correct HTTP status; internal details never leaked (F-048).
- **Audit:** boundary interceptor logs actor, org, action, entity, ip, ua, timestamp for auth events, PHI access, exports, role/billing changes (F-001).
- **Rate limiting:** Redis-backed, **fail-closed** for auth and AI endpoints; per-user/org quotas on generation (F-018, F-024).
- **Observability:** structured JSON logs with a request/trace correlation ID shipped off-host; `/health` + `/ready`; env validated at boot (F-042, F-067).
- **Secrets:** only `api`/`worker` hold DB/AI/Stripe/storage secrets; `web` holds only its session-validation secret and public config; no `NEXT_PUBLIC_` secret ever (F-008).
