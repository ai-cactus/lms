---
name: app-setup
description: How to run the LMS app and infrastructure for E2E testing
metadata:
  type: project
---

The LMS requires Docker containers for DB and Redis to be running before tests or the app can start.

**Start infra:**
```
docker compose -f docker-compose.dev.yml up -d db redis
```
- DB: `pgvector/pgvector:pg16` mapped to `localhost:5433` (container: `lms-dev-db`)
- Redis: `redis:7-alpine` mapped to `localhost:6380` (container: `lms-dev-redis`)

**DATABASE_URL** is commented out in `.env` — create `.env.local` with:
```
DATABASE_URL="postgresql://postgres:0951@localhost:5433/lms?schema=public"
REDIS_URL=redis://localhost:6380
NEXT_PUBLIC_APP_URL=http://localhost:3005
APP_URL=http://localhost:3005
```
(Note: `.env` sets REDIS_URL to 6379 but Docker maps to 6380 — `.env.local` fixes this)

**Playwright** runs `npm run dev -- -p 3005` via `webServer` in playwright.config.ts. The `reuseExistingServer: !process.env.CI` means if the app is already running on 3005 it won't restart.

**Run E2E tests:**
```
npx playwright test tests/e2e/signup-email-verification.spec.ts --reporter=list
```

**Why:** The DATABASE_URL being commented out is intentional — likely to prevent accidental use of a local DB. Always override via `.env.local` for local development/testing.

**How to apply:** Before running Playwright tests, always ensure Docker containers are up and `.env.local` has correct DB URL with port 5433 and Redis on 6380.
