---
name: gotcha-no-dmmf-ondelete-at-runtime
description: The generated client's runtimeDataModel carries no onDelete and @prisma/internals is not installed, so an FK-behaviour test must parse prisma/*.prisma text
metadata:
  type: project
---

`generated/prisma/internal/class.ts` embeds `config.runtimeDataModel`, but its relation fields have NO `onDelete`; `Prisma.dmmf` is not exported by the `prisma-client` generator, and `@prisma/internals` (getDMMF) is not in node_modules.

**Why:** PR B's plan asked for a "cascade manifest test from the generated DMMF"; that data does not exist at runtime here.

**How to apply:** for any test asserting Cascade/SetNull/Restrict, use the shared line parser `parsePrismaSchema()` in `src/test/prisma-schema.ts` (relations with Prisma's default onDelete, scalar fields, models); both /system manifest tests (user + organization) use it. Do not copy the regex into a new test. Related: [[project_offline_migrations]], [[gotcha-org-hard-delete-cross-tenant-edges]].
