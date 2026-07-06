# 06 — Infrastructure Specification

**Prerequisite:** [`01-TARGET-ARCHITECTURE.md`](./01-TARGET-ARCHITECTURE.md). Target-agnostic where possible (works on a managed platform, Kubernetes, or Docker Compose on VMs); notes call out the current single-VM setup and what must change.

## 1. Deployment topology (target)

Three independently deployable services + shared backing stores:

| Deployable | Image | Public? | Scale | Resource profile (start) |
|------------|-------|---------|-------|--------------------------|
| `web` (Next.js) | Node 20 slim | Yes (behind ingress) | Horizontal, stateless | 0.5–1 vCPU / 512M–1G |
| `api` (NestJS) | Node 20 slim | **No** (private) | Horizontal, stateless | 1 vCPU / 1G |
| `worker` (NestJS/BullMQ) | Node 20 + `ffmpeg` + `poppler-utils` | **No** (private) | Horizontal by queue | 1–2 vCPU / 1–2G |
| PostgreSQL 16 + pgvector | managed preferred | No | primary + replica | managed / 2 vCPU / 4G+ |
| Redis 7 | managed preferred | No | HA (Sentinel/cluster) | managed / 1G |
| Object storage | GCS (+ MinIO/S3 fallback) | via signed URLs | — | — |

Only `web` is reachable from the internet (through the ingress/WAF). `api`, `worker`, and all stores live on a **private network with no public ports** — the current compose already loopback-binds the app and internalizes db/redis/minio; formalize this as a real network boundary. *(Resolves the shared-trust-boundary problem; supports F-025, F-007, F-008.)*

## 2. Ingress & transport

- **One consistent path:** ingress/WAF (Cloudflare **Enterprise with a BAA**, or an in-house LB with WAF) → `web`. Today the Cloudflare Tunnel routes straight to the app and bypasses nginx, and nginx's `server_name` doesn't match the prod host (F-043) — collapse to a single enforced ingress that applies body-size limits, timeouts, real-IP, and security headers.
- **TLS everywhere:** public TLS at the edge; **internal service-to-service TLS/mTLS** on the private network (today app→MinIO is `MINIO_USE_SSL:false`, app→Postgres/Redis are plaintext on the bridge — tolerable on one host, a §164.312(e) violation the moment services split across machines — F-025).
- **Security headers** (missing today — F-019): CSP, `Strict-Transport-Security`, `X-Frame-Options: DENY`/`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. Set at the edge and/or `web` (helmet on `api`).
- **Uploads bypass the app:** browser → signed URL → storage directly (avoids the Cloudflare 100 MB proxied-body cap vs the 500 MB app limit mismatch — F-cross).

## 3. Runtime services

- **PostgreSQL 16 + pgvector:** managed instance with automated encrypted backups + PITR (F-004) and a read replica option; **not** on an app host's disk. Pooled connection (PgBouncer) for the app, direct URL for migrations (F-026).
- **Redis 7:** managed, auth-enabled, persistence + HA. Used for BullMQ, rate-limiting, and session/MFA state. Rate-limiting must be **Redis-only with fail-closed** on outage for auth paths (drop the per-process in-memory fallback — F-024).
- **Object storage:** GCS primary with CMEK; MinIO/S3 fallback with SSE; private buckets; server-minted signed URLs only; lifecycle + versioning + replication (F-025, F-004).
- **SMTP:** provider with a BAA if any message can carry PHI; pooled transport; delivery tracked via the `email-dispatch` queue + `EmailMessage` table (F-020/F-021).
- **AI:** Vertex via ADC/service account (BAA path); consumer Gemini SDK forbidden on PHI paths (F-003).

## 4. Migrations & deploys

- **One deploy mechanism.** Retire the dual PM2-scripts + Docker/GHCR-CI setup (F-029); pick containers with **immutable image tags** (sha-pinned, not moving branch tips) and a **documented rollback** (redeploy prior tag).
- **Migrations as a one-shot job** in the deploy pipeline — not `prisma migrate deploy` on every container start *and* in a shell script (double-execution / replica race — F-030/register).
- **Pin all image tags** (no `minio/minio:latest` — F-044).
- **CI (fix F-030):** lint/format/typecheck/unit + **integration + Playwright e2e** + `npm audit` + secret-scan, all gating PRs; branch protection requiring the checks; build artifacts = the immutable images.

## 5. Configuration & env contract

**Validate every variable at boot with a Zod/envalid schema per service (fail-fast — F-042).** Grouped by tier:

- **`web` (public only, no secrets):** `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINUTES`. **Never** `NEXT_PUBLIC_GEMINI_API_KEY` (F-008).
- **`api`:** `DATABASE_URL` (pooled) + `DIRECT_URL`, `REDIS_URL`, `AUTH_SECRET` (single — F-035), `AUTH_MICROSOFT_ENTRA_ID_ID/_SECRET/_TENANT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_{STARTER,PROFESSIONAL}_{,QUARTERLY,YEARLY}_PRICE_ID`, `SMTP_*`/`ZOHO_*`, `ENTERPRISE_CONTACT_EMAIL`, `GCP_BUCKET_NAME`, `GCS_KEY_BASE64`, `GOOGLE_PROJECT_ID`, `GOOGLE_LOCATION`, `GEMINI/VERTEX` config, `MINIO_*`, `SYSTEM_ADMIN_PASSWORD` (→ real accounts over time), `INACTIVITY_TIMEOUT_MINUTES`, hCaptcha secret (new — F-023).
- **`worker`:** the `api` DB/Redis/storage/email/AI vars + `V46_GENERATION_TIMEOUT_MS`, `REMINDER_*`, `VIDEO_SWEEP_*`, `MAX_VIDEO_UPLOAD_BYTES`, `NODE_OPTIONS`.

## 6. Secrets management

- Central secrets manager (cloud KMS / Vault), **per-secret**, with rotation — not one base64 env blob SCP'd to a VM (today's `*_ENV_BASE64` pattern).
- **Remove committed sensitive info** from `.claude/agent-memory/*` (dev DB password, GCP SA email, test creds, defect notes — F-060) and rotate anything exposed.
- Keep `.env*` gitignored (already true); only public `NEXT_PUBLIC_*` values in `web` builds.

## 7. Observability & operations

- **Logs:** structured JSON with a request/trace **correlation ID**, shipped off-host (Datadog/CloudWatch/Loki) with rotation + retention (audit logs ≥6 yr for HIPAA); auto-redact PII/tokens via a logger serializer, not call-site discipline (F-067).
- **Audit log** is a separate durable, append-only store (doc 04 §2; F-001).
- **Health/readiness:** `/health` (DB+Redis) and `/ready` per service; the deploy gates on them.
- **Monitoring/alerting (missing today):** APM/error tracking (e.g. Sentry), uptime alerts on `/health`, queue-depth/DLQ alerts, backup-success alerts.
- **Incident response:** runbook, on-call, postmortem template (SOC 2 CC7.3/7.4).
- **Graceful shutdown:** close BullMQ workers on SIGTERM (today only Prisma disconnects); drain in-flight jobs.

## 8. High availability & backups (F-004)

- No single-VM SPOF: at least one standby for Postgres and Redis; `web`/`api`/`worker` each ≥2 replicas behind the LB/queue.
- Automated **encrypted backups** with **tested restore** for Postgres (PITR), object storage (versioning/replication), and Redis (off-host snapshot). Monitor backup success.

## 9. What changes vs. today (summary)

| Today | Target |
|-------|--------|
| One Next.js process does web + API + workers + cron | Three services: `web` / `api` / `worker`; cron in `worker` |
| Workers start on `/system` page-load | Workers always-on at service boot (F-005) |
| Single VM, bind mounts, no backups | Managed/replicated stores, encrypted, backed up (F-004, F-025) |
| Two deploy systems (PM2 + Docker) | One, immutable tags, one-shot migrations (F-029) |
| Tunnel bypasses nginx; hostname mismatch | Single enforced ingress with headers + limits (F-043, F-019) |
| Secrets as one base64 blob; some in VCS | Secrets manager + rotation; none in VCS (F-060) |
| Gemini key in browser build | No `NEXT_PUBLIC_` secret ever (F-008) |
| No monitoring/alerting/IR | APM + alerts + runbook |
