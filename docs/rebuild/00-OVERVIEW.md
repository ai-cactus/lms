# Rebuild Documentation — Overview & Reading Guide

**Date:** 2026-07-05 · **Goal:** split the current Next.js monolith into a **retained Next.js frontend + a separate backend + a separate worker service**, structured for security and HIPAA/SOC 2 compliance, and documented well enough for any engineer or agent to rebuild the system correctly.

## Why this document set exists

Today Theraptly LMS is a single Next.js application that does everything: renders the UI, queries PostgreSQL directly from React server components, runs 31 server-action RPC modules that hold all the business logic, calls Vertex AI and Stripe inline in request handlers, and runs its background job workers *inside the web process*. This works, but it means:

- The **frontend and the sensitive backend share one trust boundary** — the browser-facing process holds the database credentials, the AI keys, and the PHI. That is the opposite of what a HIPAA/SOC 2 auditor wants.
- The system **cannot scale horizontally** and needs a 4 GB heap because heavy work (document parsing, AI generation) runs on the request path.
- Background jobs and compliance reminders **only run when a human loads a page**.

Splitting into a frontend + backend + worker fixes all three at once. This set specifies the target so the split can be executed incrementally and safely.

## The documents

Read them in order for a full picture; each is also self-contained enough to hand to a single engineer or agent.

| # | Document | What it specifies | Primary audience |
|---|----------|-------------------|------------------|
| 00 | **This file** | The map, the target shape, the guiding principles | Everyone |
| 01 | [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md) | The chosen 3-service architecture, the backend-stack decision & tradeoffs, service boundaries, request/data flows | Architects, tech leads |
| 02 | [`02-FRONTEND-SPEC.md`](./02-FRONTEND-SPEC.md) | The retained Next.js app: what changes, the HTTP client layer to introduce, per-area data/auth/upload/polling requirements, session-cookie contract | Frontend engineers |
| 03 | [`03-BACKEND-SPEC.md`](./03-BACKEND-SPEC.md) | The new backend service: full REST API contract (every endpoint), auth model, module layout, validation & error standards | Backend engineers |
| 04 | [`04-DATA-STORAGE-SPEC.md`](./04-DATA-STORAGE-SPEC.md) | The database (every model, enum, JSON shape, index, cascade), pgvector/RAG store, object storage, migration reuse | Backend / DBA |
| 05 | [`05-AI-PIPELINE-WORKERS-SPEC.md`](./05-AI-PIPELINE-WORKERS-SPEC.md) | The worker service: queue topology, the v4.6 generation pipeline, PHI scanning, job payloads, model configs | Backend / ML engineers |
| 06 | [`06-INFRASTRUCTURE-SPEC.md`](./06-INFRASTRUCTURE-SPEC.md) | Deployment topology, per-service resource profiles, networking, env-var contract, secrets, observability, backups | DevOps / SRE |
| 07 | [`07-SECURITY-COMPLIANCE-SPEC.md`](./07-SECURITY-COMPLIANCE-SPEC.md) | HIPAA + SOC 2 control implementation, tenant isolation, audit logging, BAA data-flow, the security controls to build in | Security / compliance |
| 08 | [`08-MIGRATION-PLAN.md`](./08-MIGRATION-PLAN.md) | The phased, low-risk sequence to get from today's monolith to the target without a big-bang cutover | Everyone executing the work |

They are grounded in the current codebase: the [analysis report](../analysis/SYSTEM-ANALYSIS-REPORT.md) and [findings register](../analysis/FINDINGS-REGISTER.md) are the "before" picture, and every finding that the rebuild resolves is cross-referenced by ID (e.g. *resolves F-015*).

## The target shape in one diagram

```
                    ┌─────────────────────────────────────────────┐
                    │            Cloudflare (WAF/TLS, BAA)          │
                    └───────────────────────┬─────────────────────┘
                                            │ HTTPS
                              ┌─────────────┴─────────────┐
                              │   Next.js Frontend (web)   │  ← public tier: no DB, no secrets,
                              │   SSR + client, sessions   │    no PHI, no AI keys
                              └─────────────┬─────────────┘
                                            │ HTTPS (private network, mTLS/service token)
        ┌───────────────────────────────────┴───────────────────────────────┐
        │                         Backend API (private)                       │  ← owns Prisma, PHI,
        │  auth · courses · enrollments · quizzes · billing · documents ·     │    Stripe, AI keys,
        │  notifications · reports · admin · media · audit-log middleware     │    audit logging
        └───┬──────────────┬───────────────┬───────────────┬─────────────────┘
            │ enqueue       │               │               │
            ▼               ▼               ▼               ▼
   ┌──────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐
   │ Worker svc   │  │ PostgreSQL │  │   Redis    │  │ Object store │
   │ (always-on)  │  │ + pgvector │  │ BullMQ +   │  │ GCS (primary)│
   │ AI gen, PHI  │  │ encrypted, │  │ rate-limit │  │ + MinIO/S3   │
   │ scan, video, │  │ backed up  │  │ + sessions │  │ signed URLs  │
   │ reminders,   │  └────────────┘  └────────────┘  └──────────────┘
   │ exports, cron│         │
   └──────┬───────┘         │
          │ egress (BAA path)
          ▼
   ┌──────────────────────┐
   │ Google Vertex AI      │  ← only the backend/worker tier reaches AI/GCS
   │ (Gemini, embeddings)  │    Consumer Gemini SDK is FORBIDDEN on PHI paths
   └──────────────────────┘
```

## Guiding principles (apply to every document)

1. **The frontend is a pure client of the backend.** After the split it holds no database credentials, no AI/storage keys, and never touches PHI directly. Every one of today's 26 direct-Prisma pages, 31 server-action modules, and inline Stripe/AI/email calls becomes an HTTP call. *(Resolves F-007, F-008 exposure surface, the whole compliance-boundary story.)*
2. **Workers are a separate, always-on service** — never bootstrapped from a page render. *(Resolves F-005, F-015.)*
3. **Nothing heavy runs on the request path.** Document parsing, AI generation, PHI scanning, report generation, and video handling are queued jobs. *(Resolves F-016, F-017.)*
4. **Default-deny authorization, centrally enforced.** One `requireSession()` + `requireSameOrg(resource)` guard wraps every endpoint; MFA is enforced in that guard, not just in page middleware. *(Resolves F-012, F-013, F-009, F-010.)*
5. **Compliance is built in, not bolted on.** An append-only audit log at the API boundary; encryption at rest; backups; PHI never sent to a non-BAA path or stored raw. *(Resolves F-001, F-025, F-004, F-002, F-003.)*
6. **Preserve what works.** The Prisma schema, the reminder engine, the storage abstraction, the AI client, the sanitizer, and the (already-fixed) security controls port forward with minimal change. This is a re-plumbing, not a rewrite.

## Backend stack decision (summary — full rationale in doc 01)

**Recommendation: NestJS (Node/TypeScript) for the backend + a dedicated BullMQ worker service in the same stack.** The user's only constraint was "frontend stays Next.js, backend can be any stack." Because the entire business layer is already TypeScript with Prisma, Zod, and hand-rolled Vertex/Stripe/storage clients, a TypeScript backend lets ~80% of the existing `src/lib` and `src/app/actions` logic port almost verbatim, while a framework (NestJS) supplies the dependency injection, guards, interceptors, and module structure the current opt-in-auth monolith lacks. Doc 01 records the alternatives considered (Fastify/Express, Python/FastAPI, Go) and why they lose to reuse economics here.
