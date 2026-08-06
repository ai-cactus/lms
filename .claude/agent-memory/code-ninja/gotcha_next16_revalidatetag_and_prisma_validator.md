---
name: gotcha-next16-revalidatetag-and-prisma-validator
description: Next 16 revalidateTag now needs a 2nd arg; the prisma-client generator has no Prisma.validator — use `satisfies` for typed selects.
metadata:
  type: feedback
---

Two version-specific gotchas hit while adding cached reads / typed Prisma selects (Next 16.2.11 + the new `prisma-client` generator, output `generated/prisma`).

**1. `revalidateTag` requires a second argument in Next 16.**
`revalidateTag(tag)` (single-arg) now emits a deprecation warning and TS errors (`Expected 2 arguments`). Signature is `revalidateTag(tag: string, profile: string | { expire?: number })`.
- **How to apply:** pass `revalidateTag('my-tag', 'max')` to preserve the classic full-purge behavior (`'max'` is what the deprecation message itself recommends). In a Server Action you *may* instead use `updateTag('my-tag')` (single-arg, read-your-own-writes) — but `updateTag` THROWS if called from a route handler (`page.endsWith('/route')`), so `revalidateTag(tag, 'max')` is the safer, context-agnostic choice. `unstable_cache(...)`'s `tags` are still invalidated by `revalidateTag`/`updateTag` (both call the same internal `revalidate([encodeCacheTag(tag)])`). `unstable_cache` itself is still present and valid in Next 16 (see `src/lib/billing-prices.ts`, `src/app/actions/offering.ts`).

**2. The `prisma-client` generator does NOT export `Prisma.validator`.**
`generated/prisma/internal/prismaNamespace.ts` has no `validator` (nor most legacy `Prisma.*` helpers). So the classic `Prisma.validator<Prisma.XSelect>()({...})` for a reusable, literal-narrowed select is unavailable.
- **How to apply:** define a reusable select as `const sel = {...} satisfies Prisma.XSelect` and derive its type via `Prisma.XGetPayload<{ select: typeof sel }>`. Because `satisfies` doesn't narrow bare sort literals, write `orderBy: { order: 'asc' as const }` (the `as const`) or the object fails the `satisfies` check against `SortOrder`. A plain-object select const like this has NO Prisma runtime, so it's safe to place in `src/types/*` (imported by client components) — keep `import { Prisma }` type-only there. In a `'use server'` file you can't *export* such a const (only async fns), but a module-local const or an import from a non-server module is fine. See `courseDetailSelect` in `src/types/course.ts`.
