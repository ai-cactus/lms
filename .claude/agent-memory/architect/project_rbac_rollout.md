---
name: rbac-rollout
description: RBAC six-role rollout plan — enum migration, auth rework, authorize helper, backfill script
metadata:
  type: project
---

Planning started 2026-06-30. Converting `UserRole { admin worker }` to six roles (owner, super_admin, hr, clinical_director, finance, worker). Key files: `src/lib/rbac/permissions.ts` (already written), `prisma/auth.prisma`, `src/lib/create-auth-instance.ts`, `src/auth.ts`, `src/auth.worker.ts`.

**Why:** Full RBAC rollout replacing binary admin/worker roles with role-based permissions for owner, superAdmin, hr, clinicalDirector, finance, worker.

**How to apply:** Plan approved → hand to code-ninja. Key constraint: DB migration + code deploy must be coordinated (migration runs before new code starts, backfill runs after). Stale admin JWT force-logout is a requirement. The `authorize()` helper goes in `src/lib/rbac/authorize.ts` and is applied to billing routes as the established pattern.

Related: [[video-upload-fix]]
