#!/usr/bin/env sh
# scripts/secrets-scan.sh — staged-only secret scan.
#
# Called by .husky/pre-commit and by `npm run secrets:scan`.
#
# DEGRADES GRACEFULLY: gitleaks is a Go binary, not an npm dependency, so a
# fresh clone will not have it. Blocking every commit on a missing external
# tool would push the developer straight back to `--no-verify`, which is the
# exact failure mode this whole setup exists to eliminate. CI still runs the
# full working-tree scan on every PR, so a leak is caught before it can merge.
#
#   Install:  brew install gitleaks
#             go install github.com/gitleaks/gitleaks/v8@latest
#             https://github.com/gitleaks/gitleaks/releases
#
#   Bypass:   SKIP_SECRET_SCAN=1 git commit ...
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -n "${SKIP_SECRET_SCAN:-}" ] && [ "${SKIP_SECRET_SCAN}" != "0" ]; then
  echo "  ⚠  SKIP_SECRET_SCAN set — staged secret scan skipped."
  exit 0
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "  ⚠  gitleaks not found on PATH — staged secret scan SKIPPED." >&2
  echo "     Install it so leaks are caught before they leave your machine:" >&2
  echo "       brew install gitleaks" >&2
  echo "       go install github.com/gitleaks/gitleaks/v8@latest" >&2
  echo "     CI still scans the full working tree on every PR." >&2
  exit 0
fi

# v8.19.0 deprecated `detect`/`protect` in favour of `git`/`dir`/`stdin`.
# `gitleaks protect --staged` still works but is hidden from --help, so prefer
# the modern spelling and fall back for older binaries.
if gitleaks git --help >/dev/null 2>&1; then
  exec gitleaks git --pre-commit --staged \
    --config .gitleaks.toml --redact --no-banner
else
  exec gitleaks protect --staged \
    --config .gitleaks.toml --redact
fi
