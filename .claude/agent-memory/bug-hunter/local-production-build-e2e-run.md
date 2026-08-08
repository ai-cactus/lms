---
name: local-production-build-e2e-run
description: How to run the full Playwright suite locally against a production build (next build && next start), mirroring CI, instead of the usual dev-mode webServer — env vars, MinIO port-mapping gotcha, reuseExistingServer trap
metadata:
  type: project
---

Most sessions run e2e locally against `next dev` (per `playwright.config.ts`'s default
local `webServer.command`). When asked to mirror CI more closely (production build), the
recipe differs from the usual dev-mode env exports in a few ways:

**1. Build with every URL env var set to `:3005` BEFORE `npm run build`** —
`NEXT_PUBLIC_*` vars are inlined into the client bundle at build time (same trap as
[[ui-updates-reconciliation-e2e-env-fixes]] Trap 1, but here it's `next build` baking it in,
not a hand-started dev server). Export `DATABASE_URL`, `REDIS_URL`, `AUTH_URL`,
`NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `APP_URL`, `MINIO_PORT`, `E2E_TEST_BYPASS_RATE_LIMIT`
all before the build command, then again before `npm run start -- -p 3005`.

**2. `src/lib/rate-limit.ts`'s E2E bypass requires BOTH `NODE_ENV !== 'production'` OR a
localhost `AUTH_URL` — a production build (`next start` sets `NODE_ENV=production`) only
gets the bypass if `AUTH_URL`/`NEXTAUTH_URL`/`APP_URL` resolve to `http://localhost(:port)`.**
Get this wrong and every login attempt in the suite silently rate-limits after a handful of
tests, with no direct error pointing at the cause.

**3. MinIO port mismatch**: this repo's local dev Docker container (`lms-dev-minio`) maps
host port **9005** → container 9000, but `.env`'s `MINIO_ENDPOINT`/`MINIO_PORT` say
`localhost:9000` (the CI-container convention, where 9000 IS the host port). Locally,
`localhost:9000` is unreachable (confirmed via `curl .../minio/health/live` → connection
refused on 9000, 200 on 9005) unless you export `MINIO_PORT=9005` for the server process.
`MINIO_PORT` is read server-side at request time (`src/lib/storage/minio-provider.ts`), so
this can be set on the `npm run start` command without rebuilding. Skipping this doesn't
fail loudly — it just makes every storage-dependent e2e assertion silently self-skip via the
established MinIO-reachability probe pattern (see
[[ui-updates-reconciliation-e2e-env-fixes]]).

**4. `playwright.config.ts`'s `webServer.command` is `next start` only when
`process.env.CI==='true'`.** If you hand-start the production server yourself (recommended,
so you control its env precisely) and then run `npx playwright test`, do NOT also set
`CI=true` in the playwright shell — with `CI=true`, `reuseExistingServer` becomes `false`
and Playwright refuses to reuse your already-running `:3005` server ("already used... set
reuseExistingServer:true"). Leave `CI` unset in the playwright shell; `reuseExistingServer:
!CI` then defaults to `true` and it attaches to your manually-started server. Pass
`--workers=1 --retries=1` (or `--retries=0` for a clean isolation rerun) explicitly instead
of relying on `CI` to set those.

**Outcome this session**: a full 140-test suite against a real production build completed in
~15.6 minutes with these settings, and — critically — surfaced a genuine regression
([[proxy-redirect-during-server-action-crash]]) that a dev-mode run might have masked or
behaved differently under (dev-mode's Fast Refresh / different chunk-loading behavior is a
plausible confound for this specific class of RSC-navigation error). When a diff touches
`src/proxy.ts` or any Server-Action `redirectTo`, prefer a production-build run over the
default dev-mode one for exactly this reason.
