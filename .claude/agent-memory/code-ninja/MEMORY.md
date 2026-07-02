# Code-Ninja Memory Index

- [Auth instance-selector vs DB role](auth_instance_vs_role.md) — the `'admin'|'worker'` cookie/routing selector is NOT the DB role; don't conflate them.
- [Build type-checks everything](build_typecheck_scope.md) — `next build` type-checks scripts/ and tests too; `npm run lint` only covers src/.
- [RBAC role model](rbac_role_model.md) — six snake_case DB roles; snake↔camel conversion lives only in src/lib/rbac/role-utils.ts.
- [Org/Facility split](org_facility_split.md) — location/compliance fields moved to Facility; one facility per org; facility.* = owner+supervisor only.
- [Offline migrations](project_offline_migrations.md) — dev DB (localhost:5433) often unreachable; scaffold Prisma migrations offline via `migrate diff --from-schema/--to-schema`.
- [Vitest @/generated alias](project_vitest_generated_alias.md) — vitest.config.mts must alias @/generated & @/db (most-specific first) or value-imports of generated Prisma fail in tests.
