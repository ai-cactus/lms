---
name: npm-install-allow-remote
description: Fresh `npm install` fails with EALLOWREMOTE on npm 12 because 293 lockfile entries resolve to registry.npmmirror.com; use --allow-remote=all.
metadata:
  type: project
---

A fresh `npm install` in this repo fails on npm 12+ with `npm error code EALLOWREMOTE / Refusing to fetch "zod-validation-error@https://registry.npmmirror.com/..."`. Work around it with `npm install --allow-remote=all` (also needed for `npm update`).

**Why:** `package-lock.json` carries ~293 `resolved` URLs pointing at `registry.npmmirror.com` (a China mirror, left over from a past contributor's environment). npm's `replace-registry-host=npmjs` doesn't recognise that host, so npm classifies those tarballs as "remote" type, and npm 12 refuses remote fetches by default (`allow-remote=none`). Most entries survive from cache; the first uncached one aborts the install. Separately, `xlsx` is a genuinely remote dep (`https://cdn.sheetjs.com/...tgz`) declared in `package.json`.

**How to apply:** Always pass `--allow-remote=all` when installing/updating in a clean checkout or worktree. It does not dirty the lockfile — verified that install with the flag leaves `package-lock.json` byte-identical. CI is unaffected: the audit workflows never install, and other jobs run on node 24's bundled npm 11, which has no such gate. If someone ever normalises those URLs to `registry.npmjs.org`, the flag becomes unnecessary (integrity hashes are identical, since npmmirror serves the same tarballs).

**Also:** npm 12 blocks install scripts for 8 packages (`@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`, `core-js`, `fsevents`, `msgpackr-extract`) because there is **no** `allowScripts` field in `package.json`. This is harmless — `prisma generate`, `npm test` and `npm run build` all work without them, so don't add an allowlist to silence the warning.

See [[offline-migrations]] for the related dev-DB connectivity gotcha.
