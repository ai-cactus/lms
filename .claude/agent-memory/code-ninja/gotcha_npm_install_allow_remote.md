---
name: npm-install-allow-remote
description: npm 12 refuses 'remote' tarballs by default; the npmmirror lockfile URLs are gone, but the xlsx CDN tarball dep likely still needs --allow-remote=all
metadata:
  type: project
---

npm 12+ defaults to `allow-remote=none` and aborts an install with
`npm error code EALLOWREMOTE / Refusing to fetch …` when a dependency resolves to
a non-registry URL.

**History:** `package-lock.json` used to carry ~293 `resolved` URLs pointing at
`registry.npmmirror.com`, which npm classified as remote. Those were repointed to
`registry.npmjs.org` in `4213cf43` (`grep -c npmmirror package-lock.json` → 0).

**What remains:** `xlsx` is a genuinely remote dependency declared in
`package.json` (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), so a clean
`npm install` / `npm update` on npm 12 very likely still needs
`--allow-remote=all`. Not re-tested since the lockfile cleanup — if a plain
install succeeds, this note can go. The flag does not dirty the lockfile. CI is
unaffected: other jobs run on node 24's bundled npm 11, which has no such gate.

**Also:** npm 12 blocks install scripts for several packages (`@prisma/engines`,
`esbuild`, `prisma`, `unrs-resolver`, `core-js`, `fsevents`, `msgpackr-extract`)
because there is **no** `allowScripts` field in `package.json`. This is harmless —
`prisma generate`, `npm test` and `npm run build` all work without them, so don't
add an allowlist to silence the warning.

See [[offline-migrations]] for the related dev-DB connectivity gotcha.
