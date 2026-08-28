/**
 * The facility scope recorded on a {@link CourseAssignment}, and the single
 * place that knows how it is encoded.
 *
 * A role-target assignment enrols every CURRENT holder of the targeted roles and
 * everyone who gains one LATER. Narrowing only the immediate enrolment leaves the
 * second half unscoped: a facility-bound supervisor's assignment would keep
 * auto-enrolling new joiners at facilities they cannot see, so its reach would
 * grow past the assigner's own over time. The scope therefore has to live on the
 * row, not just in the request that created it.
 *
 * The stored shape is the pair `(facilityScoped, facilityIds)`, which encodes the
 * `string[] | null` contract that {@link resolveDataFacilityIds} already returns
 * across the codebase. Prisma cannot express an optional scalar list
 * (`String[]?` is rejected outright), and a bare `String[]` cannot tell "the
 * whole organisation" apart from "no facility at all" — both would be `[]`. That
 * collision is the D-01 bug verbatim, so the discriminator is explicit:
 *
 *   facilityScoped = false  → org-wide; `facilityIds` is meaningless (`[]`).
 *   facilityScoped = true   → narrowed to exactly `facilityIds`, which MAY BE
 *                             EMPTY, and empty means nobody.
 *
 * `false` is the column default, so every row written before this existed decodes
 * as org-wide and keeps its original reach.
 */
/** The two columns, as any reader of an assignment row must select them. */
export interface AssignmentFacilityScopeColumns {
  facilityScoped: boolean;
  facilityIds: string[];
}

/**
 * Decode a row's scope to the canonical `string[] | null`: `null` for org-wide,
 * otherwise exactly the facilities the assignment may reach (possibly none).
 */
export function assignmentFacilityScope(row: AssignmentFacilityScopeColumns): string[] | null {
  return row.facilityScoped ? row.facilityIds : null;
}

/**
 * Encode a resolved scope for a write. Both columns are always returned together
 * so a row can never end up internally inconsistent (a stray `facilityIds` under
 * `facilityScoped: false` would be silently ignored by every reader, which is
 * exactly the kind of drift that hides a scoping bug).
 */
export function assignmentFacilityScopeColumns(
  facilityIds: string[] | null,
): AssignmentFacilityScopeColumns {
  return facilityIds === null
    ? { facilityScoped: false, facilityIds: [] }
    : { facilityScoped: true, facilityIds };
}

/**
 * Whether an assignment may enrol a holder who belongs to `holderFacilityIds`.
 *
 * Fail-closed by construction: a narrowed assignment admits a holder only on a
 * genuine intersection, so an empty scope admits nobody and a holder with no
 * facility assignments is admitted only by an org-wide assignment. Widening is
 * structurally impossible — the only path that skips the intersection test is
 * `facilityScoped: false`, which is what an org-wide assigner records.
 */
export function assignmentAdmitsHolder(
  row: AssignmentFacilityScopeColumns,
  holderFacilityIds: readonly string[],
): boolean {
  const scope = assignmentFacilityScope(row);
  if (scope === null) return true;
  return scope.some((facilityId) => holderFacilityIds.includes(facilityId));
}
