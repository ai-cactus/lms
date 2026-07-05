# Deployment & Operations Guide

**Status:** authoritative as of 2026-07-05. This document is the **single source of truth** for how Theraptly LMS is built, deployed, and operated, and it records the required ops steps for the infrastructure changes made during the security-audit remediation sweep.

## 1. The one deploy path (F-029)

Production and staging deploy via **GitHub Actions → GHCR → Docker Compose on the VM**:

- `.github/workflows/deploy-production.yml` — on push to `main`/`master`: builds the image, pushes to GHCR, SSHes to the VM, pulls, and `docker compose up -d`.
- `.github/workflows/deploy-staging.yml` — the staging equivalent.

The legacy PM2 shell scripts (`deploy.sh`, `deploy-production.sh`, `deploy-staging.sh`) have been **renamed to `*.deprecated`** — they targeted a stale `/home/homepc/lms2*` path the CD pipeline never uses, and the CD workflow already `pm2 delete`s the old process. Do **not** run the deprecated scripts. If PM2 is still installed on the VM, decommission it once you've confirmed Docker Compose owns both environments.

> `ecosystem.config.js` (PM2 config) is retained only for reference; it is not part of the live path.

## 2. Required ops steps for this sweep's infra changes

These repo edits **do not apply themselves** to the running VM. Perform the steps below, ideally in the listed order, and prefer a maintenance window for §2.3.

### 2.1 Rotate the removed Gemini key (F-008) — do this first
`NEXT_PUBLIC_GEMINI_API_KEY` was removed from `Dockerfile` and the deploy workflows. It was unreferenced in the app, but **it is already baked into historical image layers**, so removal does not revoke it.
- **Rotate the underlying key in GCP** (Console → APIs & Services → Credentials, or `gcloud`).
- Delete the `PRODUCTION_NEXT_PUBLIC_GEMINI_API_KEY` / staging GitHub secret once nothing references it.

### 2.2 Confirm the pinned MinIO image (F-044)
Both compose files were changed from `minio/minio:latest` to a pinned release tag. **Before the first deploy that picks this up**, confirm the pin matches what's already running so this stays a pin, not a surprise upgrade:
```bash
# On the VM:
docker inspect --format='{{.Image}}' lms-production-minio     # note the digest
docker image ls --digests | grep minio                        # map digest → RELEASE tag
```
If the running digest maps to a different RELEASE tag than the one pinned in `docker-compose.*.yml`, update the tag in the compose files to match, then commit. Upgrading MinIO is a separate, deliberate decision — not part of this pin.

### 2.3 Route Cloudflare Tunnel through nginx (F-043, F-019 nginx) — highest risk, isolate this
Previously `cloudflared_config.yml` routed `training.theraptly.com` / `staging-lms.theraptly.com` **straight to the app ports**, bypassing nginx — so nginx's body-size limits, real-IP handling, and (now) security headers applied to nothing. The changes:
- `lms2_nginx.conf`: added `training.theraptly.com` to the production `server_name` (the old `lms.theraptly.com` is **kept** — confirm DNS before ever removing it), and added the security-header block (mirroring `next.config.ts`) to both server blocks.
- `cloudflared_config.yml`: both ingress services now point at `http://localhost:80` (nginx), which routes by `Host` header to the correct app port.

**This can take production fully offline if misapplied. Run it alone, in a maintenance window, with a rollback ready.**
```bash
# 1. Apply the new files to the VM (via the normal deploy or by copying the two files).
# 2. Validate and reload nginx:
sudo nginx -t && sudo systemctl reload nginx
# 3. Restart the cloudflared service (exact unit name depends on the VM's setup):
sudo systemctl restart cloudflared        # or: sudo systemctl restart cloudflared-lms
# 4. Verify BOTH hostnames respond and carry the new headers:
curl -sSI https://training.theraptly.com     | grep -iE 'strict-transport|x-frame|content-security|x-content-type'
curl -sSI https://staging-lms.theraptly.com  | grep -iE 'strict-transport|x-frame|content-security'
# 5. Smoke-test login + a document/video load through the tunnel.
```
**Rollback:** `git checkout` the previous `cloudflared_config.yml` (services back to `localhost:3000/3001`), reload nginx, restart cloudflared. Keep the old file contents handy before you start.

> The CSP intentionally keeps `'unsafe-inline'`/`'unsafe-eval'` and `blob:`/`data:` sources so Next.js runtime, Quill, react-pdf workers, recharts, framer-motion, and Stripe keep working. Tightening it to nonce/hash-based requires per-library verification — do it as a follow-up, not here. If you tighten the CSP, change it in **both** `next.config.ts` and `lms2_nginx.conf` (they must stay identical).

### 2.4 Rotate the scrubbed dev credential (F-060)
Committed secrets were removed from `.claude/agent-memory/qa-mafia/*`. Rotate the dev Postgres password (`0951`, `localhost:5433`, dev-only, low blast-radius but now in git history). Optionally scrub git history with `git filter-repo`/BFG if your threat model requires it — tracked as deeper, non-blocking remediation. The `secret-scan` CI job now covers `.claude/agent-memory/**` going forward.

## 3. CI pipeline (F-030)

`.github/workflows/ci.yml` gates PRs to `dev` with: **lint · format · typecheck · test · build**, plus three new jobs:
- **Dependency Audit** (`npm audit --audit-level=high`) — **report-only** (`continue-on-error: true`) for now, because the tree has known HIGH advisories whose remediation is deferred (F-055: `xlsx` has no npm-published fix; `quill` XSS is mitigated by DOMPurify). Flip to blocking once F-055 lands.
- **Secret Scan** (gitleaks, working-tree scan including `.claude/agent-memory/**`).
- **E2E (Playwright)** — **report-only** for now; the existing specs were written for local runs and need CI-hardening. Uploads a report artifact each run. Flip to blocking once reliably green.

The heavy `test` + `build` steps were moved out of `.husky/pre-commit` (now lint-staged only) into `.husky/pre-push`, so commits stay fast and developers stop reaching for `--no-verify`.

## 4. Ops checklist — items with no repo expression (F-004, F-025, availability)

These are infrastructure/process work outside the codebase. Track them to closure:

- [ ] **Backups (F-004):** automated, encrypted Postgres backups with PITR (WAL archiving) to off-host storage; **a tested restore runbook** (an untested backup is not a backup). MinIO/GCS object versioning + off-host replication. Redis off-host snapshot (AOF on the same disk is not a backup).
- [ ] **Encryption at rest (F-025):** managed encrypted Postgres (or LUKS-encrypted volumes); MinIO SSE and/or GCS CMEK; encrypted backups. Decide on `DocumentVersion.content` (extracted document text currently stored in the DB): encrypt the column or drop it and re-derive from object storage on demand.
- [ ] **Encryption in transit (internal):** the current localhost/bridge hops (app→MinIO `MINIO_USE_SSL:false`, app→Postgres/Redis) are acceptable on one host but become a §164.312(e) gap the moment services split across machines — plan mTLS/private-network TLS before that.
- [ ] **Availability (SOC 2 A1.2):** remove the single-VM SPOF — at least one standby for Postgres and Redis; ≥2 app replicas behind a load balancer.
- [ ] **Monitoring/alerting (SOC 2 CC7):** APM/error tracking (e.g. Sentry), uptime alerts on `/api/health`, queue-depth/DLQ alerts, backup-success alerts. Decide a log-shipping destination (the new `x-correlation-id`/`correlationId` in logs is only as useful as where the logs land).
- [ ] **Incident response (SOC 2 CC7.3/7.4):** runbook, on-call rotation, postmortem template.
- [ ] **Cloudflare BAA (F-043):** if TLS terminates at Cloudflare for a PHI-handling app, the plan must be BAA-eligible (Free/Pro are not — Enterprise is).

## 5. Environments at a glance

| Env | Host | App port | Ingress | Data |
|-----|------|----------|---------|------|
| production | training.theraptly.com | 127.0.0.1:3000 | Cloudflare Tunnel → nginx:80 → app | `/home/deploy/data/*-production` |
| staging | staging-lms.theraptly.com | 127.0.0.1:3001 | Cloudflare Tunnel → nginx:80 → app | `/home/deploy/data/*-staging` |
| dev | localhost | 3000 (host) | direct | Docker volumes (Postgres 5433, Redis 6380, MinIO 9005/9006) |

Backing services (Postgres 16 + pgvector, Redis 7, MinIO) run as Compose containers per environment; GCS is primary object storage with MinIO as fallback.
