#!/usr/bin/env sh
# scripts/verify-light.sh — the LIGHT verification tier (~15-85s).
#
# Invoked by `npm run verify`, and therefore by .husky/pre-push on every branch
# that is not dev/staging/main. Verifies only what this branch changed relative
# to trunk.
#
# Base ref: the merge-base with trunk (dev). vitest's own `--changed <ref>`
# already does `git diff --name-only <ref>...HEAD` (three dots = merge-base),
# but we resolve the merge-base explicitly so eslint and vitest agree on one
# base and — critically — so we can VALIDATE it:
#
#   `vitest run --changed <nonexistent-ref>` prints "No test files found" and
#   EXITS 0. Verified against vitest 4.1.10: the git call goes through
#   tinyexec's x(), which does not throw on a non-zero exit. An unvalidated
#   base ref therefore silently skips the entire suite. We fail closed to the
#   full lint + test suite instead.
#
# No `git fetch`: it costs 1-3s and breaks offline pushes, and a stale
# origin/dev only ever over-selects tests, which is the safe direction.
set -eu

TRUNK="${VERIFY_TRUNK:-dev}"
REMOTE="${VERIFY_REMOTE:-origin}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail_closed=0
BASE=""
for cand in "$REMOTE/$TRUNK" "origin/$TRUNK" "refs/remotes/$REMOTE/$TRUNK" "$TRUNK"; do
  if git rev-parse --verify --quiet "$cand^{commit}" >/dev/null 2>&1; then
    BASE="$cand"
    break
  fi
done

BASE_SHA=""
if [ -n "$BASE" ]; then
  BASE_SHA="$(git merge-base "$BASE" HEAD 2>/dev/null || true)"
fi
if [ -z "$BASE_SHA" ]; then
  echo "verify: could not resolve a merge-base against '$TRUNK'." >&2
  echo "verify: FAILING CLOSED — running the full lint + test suite instead." >&2
  fail_closed=1
fi

# Changed files. Mirrors vitest's own union so the two agree on scope:
# committed-vs-base, unstaged, staged, and untracked.
CHANGED=""
if [ "$fail_closed" = "0" ]; then
  CHANGED="$( {
    git diff --name-only --diff-filter=ACMR "$BASE_SHA" HEAD
    git diff --name-only --diff-filter=ACMR
    git diff --cached --name-only --diff-filter=ACMR
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u )"
fi

# ── 0. Prisma client — only when the schema moved, or the client is missing ──
need_prisma=0
if [ ! -d generated/prisma ]; then need_prisma=1; fi
if printf '%s\n' "$CHANGED" | grep -qE '^prisma/.*\.prisma$'; then need_prisma=1; fi
if [ "$need_prisma" = "1" ]; then
  echo "→ prisma generate"
  npx prisma generate
fi

# ── 1. ESLint on changed files (~3-6s; the full tree is ~22s) ────────────────
echo "→ lint (changed files)"
if [ "$fail_closed" = "1" ]; then
  npm run lint
else
  LINT_FILES="$(printf '%s\n' "$CHANGED" \
    | grep -E '^(src|scripts|tests)/' \
    | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' || true)"
  if [ -z "$LINT_FILES" ]; then
    echo "  (no lintable files changed)"
  else
    # --no-error-on-unmatched-pattern covers a file deleted between the diff
    # and now. Never invoke with zero args — bare eslint lints the whole cwd.
    # shellcheck disable=SC2086
    npx eslint --no-error-on-unmatched-pattern $LINT_FILES
  fi
fi

# ── 2. Typecheck — whole project ────────────────────────────────────────────
# No changed-file mode for tsc is sound: a changed .ts can break any consumer.
echo "→ typecheck"
npm run typecheck

# ── 3. Affected unit tests ──────────────────────────────────────────────────
# --changed walks the module graph and selects DEPENDENTS of changed files,
# not just the changed files themselves.
echo "→ unit tests (affected)"
if [ "$fail_closed" = "1" ]; then
  npm run test
else
  npx vitest run --changed "$BASE_SHA" --passWithNoTests
fi

echo "verify: LIGHT tier passed (base ${BASE:-n/a} @ ${BASE_SHA:-full-suite-fallback})."
