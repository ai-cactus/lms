---
name: prisma-extension-breaks-transactionclient-type
description: $extends on the app client silently invalidates every `Prisma.TransactionClient` annotation; plus the two Prisma-7 behaviours (findUnique + non-unique where, tx inherits the extension) verified empirically, not from docs
metadata:
  type: project
---

`db/index.ts` now exports **two** clients: `prisma` (carries the Q24 archive query extension) and `rawPrisma` (the same pool, un-extended). Adding `$extends` had one non-obvious cost worth remembering.

**An extended client does not satisfy `Prisma.TransactionClient`.** That type describes the UN-extended client, and the two are not mutually assignable in *either* direction — their per-model delegates differ structurally (prisma/prisma#20738; a typing gap only). Every helper annotated `Pick<Prisma.TransactionClient, 'x'>` or `tx: Prisma.TransactionClient` goes red the moment it is handed an extended `tx`. On Phase 6 PR B that was 7 errors across 5 files, and it cascades: once `src/lib/audit.ts`'s `AuditClient` was retyped off the extended client, `system-admin.ts`'s deliberately-raw `rawPrisma.$transaction` failed the *other* way.

**The fix that works in both directions is a hand-written minimal interface**, not a `Pick` of either concrete type — e.g. `AuditClient` in `src/lib/audit.ts`, `DocumentCategoryWriter` in `src/lib/documents/document-categories.ts` (which also has to accept `prisma/seed.ts`'s own bare `PrismaClient`). `db/index.ts` also exports `DbClient` / `DbTransactionClient` for helpers that only ever see the app client.

**Two Prisma-7.10 behaviours the official docs do NOT state, verified empirically against the real client + DB:**
1. `findUnique` / `findUniqueOrThrow` **do** accept a non-unique field alongside the unique key, so merging `archivedAt: null` into their `where` works.
2. An interactive transaction **does** inherit query extensions at runtime — `prisma.$transaction(async (tx) => …)` gives an extended `tx`. The docs page on query extensions is silent on this and the transactions page never mentions extensions; only the *type* is missing, never the behaviour.

**How to apply:** before trusting any client-extension behaviour here, write a throwaway `scripts/_probe-*.ts` and run it against the dev DB (`set -a && . ./.env && set +a && npx tsx …`) — it takes two minutes and the docs will not answer. And expect any future `$extends` to break `Prisma.TransactionClient` annotations repo-wide.

Related: [[gotcha_next16_revalidatetag_and_prisma_validator]], [[project_vitest_generated_alias]].
