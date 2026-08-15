---
name: gotcha-bare-auth-drops-set-cookie
description: next-auth v5 `auth()` called with NO arguments (RSC / route-handler body) silently discards the Set-Cookie next-auth wanted to emit — so those responses never rotate the session cookie.
metadata:
  type: project
---

`auth()` called with **zero arguments** — the way every route handler and server
component in this repo calls it (via `getPortalSessions()` → `adminAuth()` /
`workerAuth()`) — does **not** propagate any `Set-Cookie`.

Verified in `node_modules/next-auth/lib/index.js` (`initAuth`): the no-args
branch is `getSession(_headers, _config).then(parseSessionResponse)` and never
reads `authResponse.headers.getSetCookie()`. Only the legacy pages-API branch
(`args[0]` is a req/res pair) copies Set-Cookie onto the response; the
middleware/wrapper branches go through `handleAuth`.

**Why it matters:** it makes `Vary: Cookie` safe on cacheable GET responses that
call `auth()` in the handler body (the video proxies). If the handler emitted a
rotating session cookie, the request's `Cookie` header would change constantly
and every cached entry would be busted immediately — the cache would buy
nothing. It also means a route handler cannot refresh a session cookie by
calling `auth()`; anything that must rewrite the cookie does it explicitly (see
`mfa-session-stamp.ts`, `expireSiblingSessionCookies`).

**How to apply:** rely on this when adding browser-cacheable responses behind
`auth()`, and re-verify against `node_modules/next-auth/lib/index.js` after any
next-auth bump — it is beta (`^5.0.0-beta.30`) and this branch could change.

Related: [[gotcha-video-playback-cache-is-in-process]]
