/**
 * The wire format of the dashboard's facility scope.
 *
 * Scope travels in the URL (`?facility=`), never in the session, so both the
 * client that writes the param and the server that re-authorises it need the
 * same grammar. This module is deliberately free of Prisma and React so it can
 * be imported from either side.
 */

/** Query parameter that carries the view's facility scope. */
export const FACILITY_SCOPE_PARAM = 'facility';

/** Facilities required before a request is a comparison rather than a drill-down. */
export const MIN_COMPARISON_FACILITIES = 2;

const FACILITY_ID_SEPARATOR = ',';

/**
 * The ids carried by a `?facility=` value: one id, or a comma-separated
 * comparison set (Next.js hands repeated params over as an array). Blanks and
 * duplicates are dropped. Nothing here is trusted — the ids are only meaningful
 * once intersected with the caller's accessible facilities.
 */
export function parseFacilityScopeParam(param?: string | string[] | null): string[] {
  const raw = Array.isArray(param) ? param.join(FACILITY_ID_SEPARATOR) : (param ?? '');
  const ids = new Set<string>();
  for (const part of raw.split(FACILITY_ID_SEPARATOR)) {
    const id = part.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/** The `?facility=` value for a selection, or `null` when the scope is org-wide. */
export function serializeFacilityScopeParam(facilityIds: string[]): string | null {
  const ids = parseFacilityScopeParam(facilityIds.join(FACILITY_ID_SEPARATOR));
  return ids.length > 0 ? ids.join(FACILITY_ID_SEPARATOR) : null;
}
