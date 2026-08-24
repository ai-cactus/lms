#!/usr/bin/env sh
# scripts/e2e-local.sh — full local Playwright run, CI-parity.
#
#   npm run e2e:local                      # everything
#   npm run e2e:local -- auth.spec.ts      # args pass straight to playwright
#   E2E_SKIP_BUILD=1 npm run e2e:local     # reuse the existing .next build
#   E2E_RESET=1      npm run e2e:local     # drop + recreate the DB, not just seed
#   E2E_KEEP_UP=1    npm run e2e:local     # leave containers running afterwards
#
# Mirrors the `e2e` job in .github/workflows/ci.yml step for step:
#   deps up → migrate deploy → db seed → build → playwright test
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f docker-compose.e2e.yml"
RUN="sh scripts/with-e2e-env.sh"

# CI=true is deliberate, and it is the whole point of "CI parity":
#   playwright.config.ts  webServer  → `npm run start -- -p 3005` (prod build).
#                                      `next dev`'s lazy route compilation has
#                                      intermittently 404'd interleaved
#                                      route-group routes.
#                         workers    → 1. REQUIRED: the specs share seeded
#                                      stateful fixtures (the locked enrollment
#                                      for Assign Retake, in-progress quiz
#                                      attempts). Parallelism corrupts them.
#                         retries    → 2
#                         reuseExistingServer → false (fails loudly if :3005 is busy)
#                         forbidOnly → true
# Use `npm run test:e2e -- <spec>` for fast single-spec iteration on a dev server.
export CI=true

echo "→ [1/6] bringing up e2e services (pg 5442, redis 6389, minio 9010, mailhog 1125)"
$COMPOSE up -d --wait db redis minio mailhog

echo "→ [2/6] ensuring the lms-documents bucket exists"
# Optional: MinIOProvider.ensureBucket() would create it lazily anyway.
$COMPOSE --profile init run --rm --no-deps mc-init

if [ -n "${E2E_RESET:-}" ]; then
  echo "→ [3/6] resetting the e2e database (drop + migrate + seed)"
  # `migrate reset` runs prisma.config.ts's seed itself.
  $RUN npx prisma migrate reset --force --skip-generate
  echo "→ [4/6] (seed ran as part of the reset)"
else
  echo "→ [3/6] applying migrations"
  $RUN npx prisma migrate deploy

  echo "→ [4/6] seeding e2e fixtures"
  # MUST run every time: the specs consume stateful fixtures. prisma/seed.ts is
  # idempotent (fixed UUIDs) and explicitly deleteMany()s quizAttempt /
  # enrollment / courseAssignment / notification to restore them.
  $RUN npx prisma db seed
fi

if [ -z "${E2E_SKIP_BUILD:-}" ]; then
  echo "→ [5/6] building the production bundle (NEXT_PUBLIC_* are inlined here)"
  $RUN npm run build
else
  echo "→ [5/6] skipping build (E2E_SKIP_BUILD set)"
fi

echo "→ [6/6] running Playwright"
$RUN npx playwright install chromium >/dev/null 2>&1 || true
set +e
# playwright.config.ts already sets testDir: './tests/e2e', so passing it here
# too would make any user-supplied filter ADDITIVE rather than narrowing —
# `-- auth.spec.ts` would run the whole suite plus auth.spec.ts.
if [ "$#" -gt 0 ]; then
  $RUN npx playwright test "$@"
else
  $RUN npx playwright test
fi
rc=$?
set -e

if [ -z "${E2E_KEEP_UP:-}" ]; then
  echo "→ tearing down e2e services (E2E_KEEP_UP=1 to keep them)"
  $COMPOSE down --remove-orphans
fi

if [ "$rc" != "0" ]; then
  echo "e2e:local FAILED. Report: npx playwright show-report" >&2
fi
exit "$rc"
