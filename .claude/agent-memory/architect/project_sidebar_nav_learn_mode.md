---
name: project-sidebar-nav-learn-mode
description: Sidebar redesign (Figma LMS v2) + Manage/Learn mode switcher for managers — plan on branch `rbac`
metadata:
  type: project
---

Plan drafted 2026-07-09 on branch `rbac` (six-role RBAC + Org/Facility split already merged with dev, tests green). Aligns `DashboardLayoutClient.tsx` / `WorkerDashboardLayout.tsx` with Figma "LMS v2 (Updated)" and adds a Manage/Learn switcher so admin-tier roles can view the real worker experience (their own enrollments) without leaving their admin account.

**Why:** Managers can be enrolled in courses like any worker; product wants them to experience `/worker/*` as themselves rather than build a parallel "admin view of worker UI."

**How to apply:** Chosen mechanism is a **session-bridge**, not widening the worker login gate:
- `src/lib/create-auth-instance.ts` gets a new optional `sessionAllowedRoles` (defaults to `allowedRoles`) used only in the `jwt()` re-validation branch. `auth.worker.ts` sets `sessionAllowedRoles: ALL_ROLES` but keeps `allowedRoles: WORKER_ROLES` — so `/api/auth-worker` credentials/OAuth login still rejects admin roles (least privilege intact); only a worker-cookie JWT that already exists can carry an admin role.
- The ONLY way an admin role gets a worker-cookie JWT is a new server action (`enterLearnMode()`) that requires a valid admin session, mints a worker-instance JWT via `next-auth/jwt`'s `encode()` (mirroring the `decode({salt: cookieName})` pattern already in `src/proxy.ts`), sets it as the `worker.session-token` cookie, and redirects to `/worker`. Reuses the admin token's `sessionId` so MFA-verified state (Redis, keyed by `userId+sessionId`) carries over without a second MFA prompt.
- `src/proxy.ts`'s `ROUTE_CONFIG.worker.allowedRoles` must become `ALL_ROLES` (route-guard only, not a login gate) so the minted admin-role worker cookie isn't bounced.
- Verified nearly every `/worker/*` page and action already resolves session via `auth.worker()`/`resolveSession()` and scopes purely by `session.user.id` (no `role === worker` hard checks found in layout.tsx, page.tsx, trainings/page.tsx, certificates/page.tsx, profile/page.tsx, courses/[id]/page.tsx, certificate.ts, enrollment.ts, course.ts) — so the bridge requires **zero changes** to those files. This is why the session-bridge beat the alternative (swapping every `/worker` `auth.worker()` call for a dual-session resolver), which would have been a much larger, higher-risk diff given the client-side `SessionProvider basePath="/api/auth-worker"` and `next-auth/react` `signOut()`/`useSession()` calls that only work against a real cookie.
- "Manage" direction needs no bridge — dual admin+worker cookies already coexist per existing proxy.ts comment.
- Residual risk flagged: logging out from one instance only clears that instance's cookie, so a manager who switched to Learn and then hits Logout from either header would leave the sibling session alive. Mitigation: both `Header.tsx` and `WorkerHeader.tsx` logout handlers unconditionally best-effort clear the sibling cookie via a new `clearSiblingSessionCookie()` server action before their existing `signOut()` call (harmless no-op for real workers, who never have an admin cookie).

Full plan (nav structure per role, file list, test impact) is in the conversation this memory was written from — re-derive from current code state if resuming, since this is a plan-stage memory, not yet implemented.

Related: [[rbac-rollout]]
