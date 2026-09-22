---
name: deploy-topology
description: Live topology is Docker Compose (ONE app container per env) behind a Cloudflare tunnel straight to the app port — pm2 and nginx are dead paths (their repo files were deleted).
metadata:
  type: project
---

The pm2 and nginx paths are gone — both `ecosystem.config.js` (deleted in `f4c50d3f`) and `lms2_nginx.conf` (deleted in `9e889ef7`) have been removed from the repo. The deploy is: build image → GHCR → SSH → `docker compose up -d`.

- **Exactly ONE `app` container per environment.** `docker-compose.production.yml` documents "keeping at 1" (two replicas would need a load balancer/swarm), started by `docker-entrypoint.sh` → `next start`. Resource limit is 1 GB memory on a 2-vCPU VM.
- **There is no replica-index env var.** Docker Compose exposes none, and `NODE_APP_INSTANCE` is set nowhere in the repo.
- **nginx is NOT in the request path.** The Cloudflare tunnel (`cloudflared_config.yml`) goes straight to `127.0.0.1:3000` (prod) / `:3001` (staging). `docs/perf/tier3-implementation-plan.md` §9.4 descoped an entire nginx work item for exactly this reason.
- **`cloudflared_config.yml` is hand-applied on the VM** — no deploy workflow copies it, so editing it in the repo changes nothing live.

**Why it matters:** A previous session built a `WORKERS_ENABLED`/`NODE_APP_INSTANCE` single-instance gate and an nginx `location` block against this obsolete picture. Both were dead code and had to be reverted. Single-process gating is unnecessary — one container means one process.

**How to apply:** Before designing anything that depends on process count, replica identity, reverse-proxy behavior, or "where does a request enter" — read `docker-compose.*.yml` and `cloudflared_config.yml`. Because ffmpeg and the SSR server share one small container, CPU-politeness (`nice`) inside the app is more relevant than any cross-process orchestration.
