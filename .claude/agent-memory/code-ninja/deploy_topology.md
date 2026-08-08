---
name: deploy-topology
description: Live topology is Docker Compose (ONE app container per env) behind a Cloudflare tunnel straight to the app port — pm2 and nginx are both dead paths despite still being in the repo.
metadata:
  type: project
---

The repo still contains `ecosystem.config.js` (pm2) and `lms2_nginx.conf`, and both are **stale artifacts, not the live path**. Verified 2026-08-08:

- **pm2 is decommissioned.** `.github/workflows/deploy-{production,staging}.yml` actively run `pm2 delete` on the old process. `docs/deployment.md` states `ecosystem.config.js` "is retained only for reference; it is not part of the live path." The deploy is: build image → GHCR → SSH → `docker compose up -d`.
- **Exactly ONE `app` container per environment.** `docker-compose.production.yml` documents "keeping at 1" (two replicas would need a load balancer/swarm), started by `docker-entrypoint.sh` → `next start`. Resource limit is 1 GB memory on a 2-vCPU VM.
- **There is no replica-index env var.** Docker Compose exposes none, and `NODE_APP_INSTANCE` is set nowhere in the repo.
- **nginx is NOT in the request path.** The Cloudflare tunnel (`cloudflared_config.yml`) goes straight to `127.0.0.1:3000` (prod) / `:3001` (staging). `docs/perf/tier3-implementation-plan.md` §9.4 descoped an entire nginx work item for exactly this reason.
- **`cloudflared_config.yml` and `lms2_nginx.conf` are both hand-applied on the VM** — no deploy workflow copies either, so editing them in the repo changes nothing live.

**Why it matters:** A previous session built a `WORKERS_ENABLED`/`NODE_APP_INSTANCE` single-instance gate and an nginx `location` block against this obsolete picture. Both were dead code and had to be reverted. Single-process gating is unnecessary — one container means one process.

**How to apply:** Before designing anything that depends on process count, replica identity, reverse-proxy behavior, or "where does a request enter" — read `docker-compose.*.yml` and `cloudflared_config.yml`, not `ecosystem.config.js` or `lms2_nginx.conf`. Because ffmpeg and the SSR server share one small container, CPU-politeness (`nice`) inside the app is more relevant than any cross-process orchestration. See [[gotcha-nginx-add-header-no-merge]] for the one nginx fact still worth keeping.
