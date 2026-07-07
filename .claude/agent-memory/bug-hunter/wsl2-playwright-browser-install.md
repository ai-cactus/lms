---
name: wsl2-playwright-browser-install
description: Playwright chromium install fails on this WSL2 sandbox's Ubuntu 26.04 (unsupported host) — fix with PLAYWRIGHT_HOST_PLATFORM_OVERRIDE
metadata:
  type: project
---

`npx playwright install chromium` (with or without `--with-deps`) fails on this dev machine
with `ERROR: Playwright does not support chromium on ubuntu26.04-x64` because the sandbox's
WSL2 Ubuntu version (26.04) is newer than Playwright 1.58.x's known-platform table (it only
maps ubuntu20/22/24.04 + a few derivatives to a download URL; unrecognized versions get no
download path at all, not even a "best effort" fallback).

**Why:** `node_modules/playwright-core/lib/server/utils/hostPlatform.js` computes a
`hostPlatform` string strictly from `/etc/os-release`; unknown/newer Ubuntu versions produce a
string with no entry in `DOWNLOAD_PATHS`, so the installer has nothing to fetch. The launch
error (`chrome-headless-shell` executable not found at revision 1208 while cache has 1229) is
a symptom of a stale/mismatched browser previously fetched under a different playwright-core
version.

**How to apply:** set `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` (the nearest
supported LTS) as an env var for both the install and every subsequent `playwright test` /
`playwright install` invocation in this sandbox. This makes the installer treat the host as
ubuntu24.04-x64, download the matching Chrome-for-Testing build (with a "BEWARE: your OS is
not officially supported" notice, harmless), and Chromium then launches fine. Once installed
this way, `npx playwright test` runs without needing the override again for that same cached
browser revision, but re-set it if you ever have to re-install/upgrade the browser here.
