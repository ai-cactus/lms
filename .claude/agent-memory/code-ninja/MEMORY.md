# Code-Ninja Memory Index

- [Auth instance-selector vs DB role](auth_instance_vs_role.md) — the `'admin'|'worker'` cookie/routing selector is NOT the DB role; don't conflate them.
- [Build type-checks everything](build_typecheck_scope.md) — `next build` type-checks scripts/ and tests too; `npm run lint` only covers src/.
- [RBAC role model](rbac_role_model.md) — 13 category-aware DB roles (5 manager + 8 worker, uniform worker perms); DEFAULT_SELF_SERVE_WORKER_ROLE + snake↔camel conversion in role-utils.ts.
- [Org/Facility split](org_facility_split.md) — location/compliance fields moved to Facility; one facility per org; facility.* = owner+supervisor only.
- [Offline migrations](project_offline_migrations.md) — dev DB (localhost:5433) often unreachable; scaffold Prisma migrations offline via `migrate diff --from-schema/--to-schema`.
- [migrate dev destructive diff](project_migrate_dev_destructive_diff.md) — `prisma migrate dev` autogen drops the raw-SQL pgvector `embedding` col + facility defaults; hand-author migrations instead.
- [Vitest @/generated alias](project_vitest_generated_alias.md) — vitest.config.mts must alias @/generated & @/db (most-specific first) or value-imports of generated Prisma fail in tests.
