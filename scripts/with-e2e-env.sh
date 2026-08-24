#!/usr/bin/env sh
# scripts/with-e2e-env.sh — run any command with the e2e environment loaded.
#
#   sh scripts/with-e2e-env.sh npx playwright test tests/e2e --ui
#   npm run test:e2e -- quiz-retake-attestation.spec.ts
#
# `set -a` marks every subsequent assignment for export, so sourcing .env.e2e
# puts the values in the REAL process environment — which outranks .env and
# .env.local for both @next/env and dotenv. Your own env files are untouched.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.e2e ]; then
  echo "with-e2e-env: .env.e2e not found at $ROOT" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env.e2e
set +a

# Last line of defence: never let a misconfigured run touch the dev database.
case "${DATABASE_URL:-}" in
  *"/lms_e2e"* | *"/lms_test"*) : ;;
  *)
    echo "with-e2e-env: refusing to run — DATABASE_URL is not an e2e database." >&2
    echo "  got: ${DATABASE_URL:-<unset>}" >&2
    exit 1
    ;;
esac

exec "$@"
