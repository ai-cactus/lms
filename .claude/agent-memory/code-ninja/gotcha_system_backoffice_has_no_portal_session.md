---
name: system-backoffice-has-no-portal-session
description: /system pages have only the system_admin_auth cookie — serve their media from an /api/system/** route; a cookie fallback on a portal /api route is dead behind the proxy
metadata:
  type: project
---

The back office (`/system/**`) is gated by `verifySystemAdminCookie()` (src/lib/system-auth.ts), NOT by NextAuth.
A system admin usually has no admin/worker portal session, so an `<img>` on a /system page pointing at a
portal-authenticated route (e.g. /api/courses/[id]/preview-poster or /thumbnail) gets 401.

**Why:** BUG-17's first cut added a `verifySystemAdminCookie()` fallback inside `/api/courses/[id]/thumbnail`.
It unit-tested green but was dead in the running app: `src/proxy.ts` `gateApiRoute()` 401s every `/api/**`
request without a portal session BEFORE the handler runs, except `SELF_AUTHENTICATED_API_PREFIXES` (`/api/system/`).
The orchestrator ruled against widening the proxy exemption; the preview moved to a GET on
`/api/system/video-courses/[courseId]/thumbnail` and the fallback was removed.

**How to apply:** any media a /system page renders must come from a route under `/api/system/` that checks
`verifySystemAdminCookie()` itself; never add a system-cookie branch to a portal route. A route's unit tests
cannot see the proxy — check `src/proxy.ts` for any alternative credential. Also: next/image must be
`unoptimized` for such routes — the optimizer fetches server-side without cookies, and throws E871 on a local
src with a query string unless `images.localPatterns` allows it.
