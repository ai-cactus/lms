---
name: e2e-seed-infra
description: How the Playwright e2e suite is seeded and hardened for CI (prisma/seed.ts, rate-limit bypass, per-role login landings)
metadata:
  type: project
---

The Playwright e2e suite runs in CI (`.github/workflows/ci.yml` job `e2e`) against Postgres+Redis services, with `npx prisma db seed` after migrations.

**Why / how it's wired:**
- Seed lives in `prisma/seed.ts`, invoked via `prisma.config.ts` → `migrations.seed = 'tsx prisma/seed.ts'` (Prisma 7; the `package.json#prisma` key is deprecated). `tsx` is a devDependency.
- `prisma/seed.ts` builds its OWN `PrismaClient` (relative import `../generated/prisma/client` + `@prisma/adapter-pg`) rather than `@/db`, because **tsx does not resolve the app's `@/*` tsconfig path aliases**. All entities are upserted by fixed UUIDs → idempotent.
- Rate limiting is bypassed in e2e via `E2E_TEST_BYPASS_RATE_LIMIT=true`, double-guarded in `src/lib/rate-limit.ts` (`NODE_ENV !== 'production' && flag === 'true'`) across `checkRateLimit`, `checkRateLimitOnly`, `recordRateLimitAttempt`.
- Microsoft Entra provider registers only when `AUTH_MICROSOFT_ENTRA_ID_ID` is set; CI supplies dummy `AUTH_MICROSOFT_ENTRA_ID_*` values. Constructing it makes no eager network call.

**Load-bearing product facts the specs depend on:**
- **Login landing is role-based:** admin → `/dashboard`, worker → `/worker`. A worker with no `organizationId` is bounced to `/onboarding-worker`, so all seeded users MUST have an org.
- Worker quiz UI is inline in `src/app/learn/[id]/page.tsx`. Options are `string[]`; `correctAnswer` stores the option TEXT. Quiz attaches to the course via `courseId` (worker flow reads `course.quiz`). Option divs carry `data-quiz-option={i}` / `data-selected` (testability hooks added for ENG-020).
- **Suspected product bug (not fixed):** `assignRetake` (src/app/actions/course.ts) throws `Enrollment is not locked` for any non-`locked` enrollment, yet the `TrainingDetails` kebab shows "Assign Retake" for every enrollment (incl. completed). Menu visibility vs server guard are mismatched.

To validate the seed offline, use the docker `lms-dev-db` (localhost:5433, pw 0951) with a scratch DB — see [[offline-migrations]].
