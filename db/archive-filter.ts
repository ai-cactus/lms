/**
 * The Q24 archive predicate, as a pure function.
 *
 * Kept out of `db/index.ts` so it can be unit-tested without constructing a
 * Prisma client (and therefore a connection pool). `db/index.ts` is the only
 * production consumer — see the query extension there for the policy this
 * implements and the limits it has.
 */

/**
 * Merge `archivedAt: null` into a read's `where`, preserving every predicate
 * the caller already supplied.
 *
 * ⚠️ The spread of `args.where` is load-bearing, not stylistic. Replacing the
 * body with `{ ...args, where: { archivedAt: null } }` would discard the
 * caller's own filters and silently widen every read in the app to the whole
 * table — including tenancy predicates. That is the failure this is unit-tested
 * against.
 *
 * The cast is a narrowing assertion, not a widening one: the result is the
 * caller's own args plus one predicate on a field every archivable model
 * declares, which TypeScript cannot express generically over Prisma's
 * per-operation argument types.
 */
export function liveRowsOnly<A extends object>(args: A): A {
  // `A extends object` rather than `{ where?: … }` because a read legitimately
  // arrives with no `where` at all — `count()` with no arguments, or a
  // `findMany` carrying only `select`. Prisma's per-operation arg types are not
  // a single shape, so the field is read through one local assertion instead.
  const where = (args as { where?: Record<string, unknown> }).where;
  return { ...args, where: { ...where, archivedAt: null } } as A;
}
