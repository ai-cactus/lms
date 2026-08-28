---
name: gotcha-next16-revalidatetag-and-prisma-validator
description: Next 16 revalidateTag needs a 2nd arg; prisma-client has no Prisma.validator (use `satisfies`); Prisma rejects optional scalar lists (`String[]?`) so nullable-array fields need a boolean+list pair.
metadata:
  type: feedback
---

Version-specific gotchas hit while adding cached reads / typed Prisma selects / nullable-array columns (Next 16.2.11 + the new `prisma-client` generator, output `generated/prisma`).

**1. `revalidateTag` requires a second argument in Next 16.**
`revalidateTag(tag)` (single-arg) now emits a deprecation warning and TS errors (`Expected 2 arguments`). Signature is `revalidateTag(tag: string, profile: string | { expire?: number })`.
- **How to apply:** pass `revalidateTag('my-tag', 'max')` to preserve the classic full-purge behavior (`'max'` is what the deprecation message itself recommends). In a Server Action you *may* instead use `updateTag('my-tag')` (single-arg, read-your-own-writes) — but `updateTag` THROWS if called from a route handler (`page.endsWith('/route')`), so `revalidateTag(tag, 'max')` is the safer, context-agnostic choice. `unstable_cache(...)`'s `tags` are still invalidated by `revalidateTag`/`updateTag` (both call the same internal `revalidate([encodeCacheTag(tag)])`). `unstable_cache` itself is still present and valid in Next 16 (see `src/lib/billing-prices.ts`, `src/app/actions/offering.ts`).

**2. The `prisma-client` generator does NOT export `Prisma.validator`.**
`generated/prisma/internal/prismaNamespace.ts` has no `validator` (nor most legacy `Prisma.*` helpers). So the classic `Prisma.validator<Prisma.XSelect>()({...})` for a reusable, literal-narrowed select is unavailable.
- **How to apply:** define a reusable select as `const sel = {...} satisfies Prisma.XSelect` and derive its type via `Prisma.XGetPayload<{ select: typeof sel }>`. Because `satisfies` doesn't narrow bare sort literals, write `orderBy: { order: 'asc' as const }` (the `as const`) or the object fails the `satisfies` check against `SortOrder`. A plain-object select const like this has NO Prisma runtime, so it's safe to place in `src/types/*` (imported by client components) — keep `import { Prisma }` type-only there. In a `'use server'` file you can't *export* such a const (only async fns), but a module-local const or an import from a non-server module is fine. See `courseDetailSelect` in `src/types/course.ts`.

**3. Prisma rejects OPTIONAL SCALAR LISTS — `String[]?` will not compile.**
`npx prisma validate` fails with P1012 "Optional lists are not supported. Use either `Type[]` or `Type?`" (verified against Prisma 7.9.1, 2026-08-27). So a column can never be "a nullable array".
- **How to apply:** when a field genuinely needs the three states `null` / `[]` / `[...]` — which is exactly the `string[] | null` contract `resolveDataFacilityIds` and `staffFacilityWhere` speak across this repo — a bare `T[]` is NOT enough: `[]` would have to mean both "unscoped/everything" and "nothing", and conflating those is D-01 verbatim. Encode it as a PAIR: an explicit boolean discriminator plus the list, defaulting the boolean to the "unscoped" value so pre-existing rows keep their old reach. Write both columns together from one helper (see `assignmentFacilityScopeColumns` in `src/lib/enrollment/assignment-facility-scope.ts`, mirroring the older `roleTargetColumns`) so a row can never be half-set, and decode through a single reader rather than touching the list column directly. `Json?` also expresses the three states but loses Prisma's typing and drags in the `DbNull`/`JsonNull` trap — prefer the pair.
