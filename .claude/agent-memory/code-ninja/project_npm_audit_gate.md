---
name: npm-audit-gate
description: The npm audit high gate is cleared via package.json overrides; minimatch@10 is pinned there and is load-bearing/fragile.
metadata:
  type: project
---

`npm audit --audit-level=high` must exit 0 — enforced by `.github/workflows/scheduled-audit.yml` (daily, opens a tracking issue) and CI job 6 "Dependency Audit". Remediation convention is a `bugfix/npm-audit-*` branch PR'd to `dev`. Fixes go in `package.json` `overrides`, never `npm audit fix --force` (its suggestions are routinely downgrades or majors).

**Why the overrides are fragile:** as of PR #410 (2026-07-27) the tree carries `minimatch: ^10.2.5` + `brace-expansion: ^5.0.8` overrides. `brace-expansion@5.0.8` was the only release patched for GHSA-mh99-v99m-4gvg, and it changed its CJS export from a callable default to a namespace object — so `minimatch` ≤9 breaks under it, forcing `minimatch@10` too. But `minimatch@10` likewise dropped its callable default, and `eslint-plugin-react` / `-import` / `-jsx-a11y` (pulled by `eslint-config-next`) still call `minimatch(...)` as a function. Roughly 12 named rules across those plugins will throw `TypeError` if ever enabled; none are enabled today.

**How to apply:** before enabling any new `react/*`, `import/*` or `jsx-a11y/*` rule, check it against that list (the PR #410 body enumerates them) or just run lint — failures are loud, never silent. When upstream finally ships `minimatch ^10` in those plugins, drop both overrides. When touching lint deps, verify with a structural lint diff (`eslint src/ -f json` before vs after, compare per-file error/warning counts) rather than just the exit code, since minimatch governs eslint's ignore/override glob matching.

Related: [[npm-install-allow-remote]] for the `--allow-remote=all` flag needed to install at all.
