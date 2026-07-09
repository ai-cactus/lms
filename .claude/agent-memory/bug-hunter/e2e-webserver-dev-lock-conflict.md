---
name: e2e-webserver-dev-lock-conflict
description: Playwright's webServer (npm run dev -p 3005) refuses to start if any `next dev` is already running against this repo dir, even on a different port — kill the :3000 dev server first
metadata:
  type: project
---

`playwright.config.ts`'s `webServer` runs `npm run dev -- -p 3005` with
`reuseExistingServer: !CI`. Next.js dev detects "another next dev server is
already running" via a lock tied to the **project directory**, not the port —
so if a `npm run dev` is already up on :3000 (e.g. a manual dev session or a
QA/browser session left running), Playwright's webServer fails immediately
with `Error: Process from config.webServer was not able to start. Exit code:
1` and every test errors before the browser even opens.

**How to apply:** before running `npx playwright test`, check
`lsof -nP -iTCP:3000 -sTCP:LISTEN` for a stray dev server and `kill` it if
found (it does not conflict with the app on 3005, only the *startup lock*
does). After the e2e run finishes, restart it with
`nohup npm run dev > /tmp/lms-dev-3000.log 2>&1 & disown` so the app stays up
for the user/other agents. This is unrelated to the AUTH_URL redirect trap in
[[e2e-local-auth-url-env-trap]] — that one causes login *tests* to fail after
the server starts; this one prevents the server from starting at all.
