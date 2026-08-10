# Deployment & Operations Guide

**Status:** authoritative as of 2026-08-10. This document is the **single source of truth** for how Theraptly LMS is built, deployed, and operated, and it records the required ops steps for the infrastructure changes made during the security-audit remediation sweeps.

> Ongoing infrastructure hardening (backups, encryption at rest, the non-superuser
> DB role, TLS in transit, secrets manager, SPOF removal) now lives in
> [`security-infra-runbook.md`](./security-infra-runbook.md), which sequences those
> items with their dependencies and verification steps. §4 below remains the
> checklist; the runbook is the procedure.

## 1. The one deploy path (F-029)

Production and staging deploy via **GitHub Actions → GHCR → Docker Compose on the VM**:

- `.github/workflows/deploy-production.yml` — on push to `main`/`master`: builds the image, pushes to GHCR, SSHes to the VM, pulls, and `docker compose up -d`.
- `.github/workflows/deploy-staging.yml` — the staging equivalent.

**Docker is the only runtime. PM2 is gone.** The legacy PM2 shell scripts (`deploy.sh`, `deploy-production.sh`, `deploy-staging.sh`) and `ecosystem.config.js` were **deleted** on 2026-08-10, and the `pm2 delete` teardown step was removed from both deploy workflows — it was running on every deploy against a process that no longer exists. Keeping the scripts "for reference" was a liability: `README.md` still told people to run `./deploy-production.sh`, which would have deployed nothing while appearing to work.

Their contents remain in git history if ever needed. There is nothing left in the repo that references a process manager: one container per service per environment, started by `docker compose up -d`.

## 2. Required ops steps for this sweep's infra changes

These repo edits **do not apply themselves** to the running VM. Perform the steps below in the listed order. §2.1 and §2.3 are now resolved and kept only as a record.

### 2.1 Rotate the removed Gemini key (F-008) — ✅ DONE
`NEXT_PUBLIC_GEMINI_API_KEY` was removed from `Dockerfile` and the deploy workflows, but it was already baked into historical image layers, so removal alone did not revoke it. **The key has since been rotated in GCP** (confirmed 2026-08-10), and the container package is private.

The consumer Gemini surface is now blocked in code as well: `eslint.config.mjs` rejects the `@google/generative-ai` / `@google/genai` SDKs and any reference to `generativelanguage.googleapis.com`, the dependency is removed from `package.json`, and `GEMINI_API_KEY` is documented in `.env.example` as do-not-reintroduce (F-085).

### 2.2 Confirm the pinned MinIO image (F-044)
Both compose files were changed from `minio/minio:latest` to a pinned release tag. **Before the first deploy that picks this up**, confirm the pin matches what's already running so this stays a pin, not a surprise upgrade:
```bash
# On the VM:
docker inspect --format='{{.Image}}' lms-production-minio     # note the digest
docker image ls --digests | grep minio                        # map digest → RELEASE tag
```
If the running digest maps to a different RELEASE tag than the one pinned in `docker-compose.*.yml`, update the tag in the compose files to match, then commit. Upgrading MinIO is a separate, deliberate decision — not part of this pin.

### 2.3 nginx is NOT in the request path — proposal withdrawn (F-043)

A previous version of this section described routing the Cloudflare Tunnel through nginx so nginx could re-assert security headers. **That change was never applied, and it is now withdrawn rather than left pending.**

The facts, verified 2026-08-10:

- `cloudflared_config.yml` routes `training.theraptly.com` → `http://localhost:3000` and `staging-lms.theraptly.com` → `http://localhost:3001`. Ingress goes **straight to the app ports**. nginx is bypassed.
- No workflow deploys `lms2_nginx.conf`; it is hand-applied on the VM, so the repo copy is documentation, not configuration.
- The proposal's only real benefit — security headers — is already delivered by `next.config.ts`, which **is** in the request path. HSTS (2y, preload, includeSubDomains), CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy and Permissions-Policy all ship from there and are verifiable with `curl -I` today.
- The proposal's other benefits (body-size limits) are enforced in-app instead: `MAX_DOCUMENT_UPLOAD_BYTES` rejects oversized uploads before buffering (F-017).

So inserting nginx into the path would add a hop, a failure mode and a second place to keep the CSP in sync, in exchange for duplicating headers that already work. The former §2.3 was also flagged "can take production fully offline if misapplied" — that is a poor trade for zero security gain.

**Decision needed from ops (not blocking):** whether `lms2_nginx.conf` and `scripts/setup_nginx_cloudflare.sh` should be deleted from the repo. They are dead as far as this application is concerned, but if nginx serves anything else on that VM the repo copy may be the only record of its config. They have been left in place pending that confirmation; delete them once you know.

Verify the headers arrive without nginx:

```bash
curl -sSI https://training.theraptly.com | grep -iE 'strict-transport|x-frame|content-security|x-content-type'
```

> The CSP intentionally keeps `'unsafe-inline'`/`'unsafe-eval'` and `blob:`/`data:` sources so Next.js runtime, Quill, react-pdf workers, recharts, framer-motion and Stripe keep working. Tightening it to nonce/hash-based requires per-library verification — do it as a follow-up. With nginx out of the picture, `next.config.ts` is the single place to change it.

### 2.4 Rotate the scrubbed dev credential (F-060)
Committed secrets were removed from `.claude/agent-memory/qa-mafia/*`. Rotate the dev Postgres password (`0951`, `localhost:5433`, dev-only, low blast-radius but now in git history). Optionally scrub git history with `git filter-repo`/BFG if your threat model requires it — tracked as deeper, non-blocking remediation. The `secret-scan` CI job now covers `.claude/agent-memory/**` going forward.

## 3. CI pipeline (F-030, F-070)

Restructured 2026-08-09. The critical change: **deploys are now gated.** `ci.yml` previously ran only on `dev`, so pushes to `main`/`staging` triggered the deploy workflows with no lint, typecheck, test, audit or secret scan at all. GitHub Actions workflows do not block one another, so simply adding a push trigger would have run CI *alongside* a bad deploy rather than stopping it.

- **`quality-gate.yml`** — a reusable (`workflow_call`) workflow holding the fast checks: **lint · format · typecheck · test · npm audit · secret scan**. `ci.yml`, `deploy-production.yml` and `deploy-staging.yml` all depend on it via `needs`, so a red gate stops a deploy.
- **`ci.yml`** — calls the gate, plus **build** and **E2E (Playwright, blocking)**. Triggers on pushes to `dev` and on PRs into `dev`/`staging`/`main`/`master`, so the promotion PRs are covered.
- **`security-scan.yml`** — Semgrep (SAST), Trivy (deps + IaC misconfig), CycloneDX SBOM, and a scheduled full-history gitleaks pass. Deliberately no CodeQL and no SARIF upload: both need paid GitHub Code Security on a private repo, so every job reports via job log + artifact instead and behaves the same either way.
- **`prune-images.yml`** — dispatch-only GHCR cleanup (private packages count against a 500 MB allowance).
- **`dependabot.yml`** — npm + github-actions, grouped, framework majors excluded.

Still report-only pending a triage pass: `npm audit` (behind a `strict-audit` input — note `npm audit` exits non-zero identically for an advisory and a registry outage, so naive blocking would let a registry blip block a hotfix), Semgrep, and Trivy.

E2E stays out of the shared gate on purpose: at ~30 minutes it would stall an urgent production deploy, so a direct push is gated on the fast checks and PR merges additionally get e2e.

The heavy `test` + `build` steps live in `.husky/pre-push` rather than `pre-commit` (lint-staged only), so commits stay fast and developers stop reaching for `--no-verify`.

## 4. Ops checklist — items with no repo expression (F-004, F-025, availability)

> **See [`security-infra-runbook.md`](./security-infra-runbook.md)** for the executable version of this
> checklist: ordering with dependency rationale (backups MUST precede any
> encryption-at-rest migration; the `lms_app` role MUST precede RLS), concrete
> commands, cost estimates, and a verification step per item. Two entries below
> have moved on since this was written — monitoring/alerting is now built but
> unapplied, and detection is no longer the binding constraint for incident
> response.

These are infrastructure/process work outside the codebase. Track them to closure:

- [ ] **Backups (F-004):** automated, encrypted Postgres backups with PITR (WAL archiving) to off-host storage; **a tested restore runbook** (an untested backup is not a backup). MinIO/GCS object versioning + off-host replication. Redis off-host snapshot (AOF on the same disk is not a backup).
- [ ] **Encryption at rest (F-025):** managed encrypted Postgres (or LUKS-encrypted volumes); MinIO SSE and/or GCS CMEK; encrypted backups. Decide on `DocumentVersion.content` (extracted document text currently stored in the DB): encrypt the column or drop it and re-derive from object storage on demand.
- [ ] **Encryption in transit (internal):** the current localhost/bridge hops (app→MinIO `MINIO_USE_SSL:false`, app→Postgres/Redis) are acceptable on one host but become a §164.312(e) gap the moment services split across machines — plan mTLS/private-network TLS before that.
- [ ] **Availability (SOC 2 A1.2):** remove the single-VM SPOF — at least one standby for Postgres and Redis; ≥2 app replicas behind a load balancer.
- [ ] **Monitoring/alerting (SOC 2 CC7):** APM/error tracking (e.g. Sentry), uptime alerts on `/api/health`, queue-depth/DLQ alerts, backup-success alerts. Decide a log-shipping destination (the new `x-correlation-id`/`correlationId` in logs is only as useful as where the logs land).
- [ ] **Incident response (SOC 2 CC7.3/7.4):** runbook, on-call rotation, postmortem template.
- [x] **Cloudflare account security — DONE (2026-08-10).** The INC-2026-08-04-01 follow-ups are addressed: the shared identity is retired, per-member accounts with 2FA are in place, zone rulesets were re-scanned across the dwell window, and the Global API Key was rolled. Detection is now covered by the Cloud Monitoring uptime check with a content matcher, which is what would have caught the original four-hour hijack (a status-code-only check stayed green throughout).
- [ ] **Cloudflare BAA (F-043) — only if the PHI position changes.** TLS terminates at Cloudflare's edge, so if the product ever handles PHI the plan must be BAA-eligible (Free/Pro are not; Enterprise is). Under the current **non-PHI-by-policy** position this is not required — see [`analysis/DATA-CLASSIFICATION.md`](./analysis/DATA-CLASSIFICATION.md).

## 5. Environments at a glance

| Env | Host | App port | Ingress | Data |
|-----|------|----------|---------|------|
| production | training.theraptly.com | 127.0.0.1:3000 | Cloudflare Tunnel → app (nginx bypassed, see §2.3) | `/home/deploy/data/*-production` |
| staging | staging-lms.theraptly.com | 127.0.0.1:3001 | Cloudflare Tunnel → app (nginx bypassed, see §2.3) | `/home/deploy/data/*-staging` |
| dev | localhost | 3000 (host) | direct | Docker volumes (Postgres 5433, Redis 6380, MinIO 9005/9006) |

Backing services (Postgres 16 + pgvector, Redis 7, MinIO) run as Compose containers per environment; GCS is primary object storage with MinIO as fallback.
