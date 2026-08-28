/**
 * `assignment-facility-scope.ts` is the single place that knows how a
 * `CourseAssignment`'s facility reach is encoded on the `(facilityScoped,
 * facilityIds)` column pair. Two contracts matter most:
 *
 *  - BACKFILL SEMANTICS (item 4): `facilityScoped = false` is the column
 *    default, so every pre-existing row decodes to org-wide (`null`) and must
 *    keep enrolling org-wide. If this regresses, every existing role
 *    assignment silently stops enrolling anyone — worse than the PII leak
 *    this branch fixes.
 *  - FAIL-CLOSED (item 5): a narrowed assignment with an empty `facilityIds`
 *    admits nobody, and a holder with no facility assignments is admitted
 *    only by an org-wide assignment — never the reverse.
 */
import { describe, it, expect } from 'vitest';
import {
  assignmentFacilityScope,
  assignmentFacilityScopeColumns,
  assignmentAdmitsHolder,
} from './assignment-facility-scope';

describe('assignmentFacilityScope (decode)', () => {
  it('BACKFILL: facilityScoped=false decodes to null (org-wide) regardless of what facilityIds holds', () => {
    expect(assignmentFacilityScope({ facilityScoped: false, facilityIds: [] })).toBeNull();
    // Even a stray non-empty facilityIds under facilityScoped:false must not
    // leak through — false is the authoritative bit.
    expect(assignmentFacilityScope({ facilityScoped: false, facilityIds: ['fac-1'] })).toBeNull();
  });

  it('decodes facilityScoped=true to exactly the recorded facilityIds', () => {
    expect(
      assignmentFacilityScope({ facilityScoped: true, facilityIds: ['fac-1', 'fac-2'] }),
    ).toEqual(['fac-1', 'fac-2']);
  });

  it('decodes facilityScoped=true with an empty facilityIds to an empty array (nobody), never null', () => {
    const scope = assignmentFacilityScope({ facilityScoped: true, facilityIds: [] });

    expect(scope).toEqual([]);
    expect(scope).not.toBeNull();
  });
});

describe('assignmentFacilityScopeColumns (encode)', () => {
  it('encodes null as facilityScoped:false with an empty facilityIds', () => {
    expect(assignmentFacilityScopeColumns(null)).toEqual({
      facilityScoped: false,
      facilityIds: [],
    });
  });

  it('encodes a non-empty array as facilityScoped:true with that array', () => {
    expect(assignmentFacilityScopeColumns(['fac-1'])).toEqual({
      facilityScoped: true,
      facilityIds: ['fac-1'],
    });
  });

  it('encodes an empty array as facilityScoped:true (narrowed to nobody), NOT facilityScoped:false (org-wide)', () => {
    // This is the collision the module doc calls out: a bare `[]` cannot tell
    // "whole organisation" apart from "no facility at all" without the
    // discriminator, so the encoder must not fold [] into the false case.
    expect(assignmentFacilityScopeColumns([])).toEqual({
      facilityScoped: true,
      facilityIds: [],
    });
  });

  it('round-trips through decode for every input shape', () => {
    for (const input of [null, [], ['fac-1'], ['fac-1', 'fac-2']]) {
      expect(assignmentFacilityScope(assignmentFacilityScopeColumns(input))).toEqual(input);
    }
  });
});

describe('assignmentAdmitsHolder', () => {
  it('an org-wide assignment (facilityScoped:false) admits any holder, including one with no facilities at all', () => {
    const row = { facilityScoped: false, facilityIds: [] };

    expect(assignmentAdmitsHolder(row, [])).toBe(true);
    expect(assignmentAdmitsHolder(row, ['fac-1'])).toBe(true);
  });

  it('a narrowed assignment admits a holder on genuine facility intersection', () => {
    const row = { facilityScoped: true, facilityIds: ['fac-1', 'fac-2'] };

    expect(assignmentAdmitsHolder(row, ['fac-2', 'fac-9'])).toBe(true);
  });

  it('a narrowed assignment rejects a holder with no overlapping facility', () => {
    const row = { facilityScoped: true, facilityIds: ['fac-1'] };

    expect(assignmentAdmitsHolder(row, ['fac-9'])).toBe(false);
  });

  it('FAIL-CLOSED: a narrowed assignment rejects a holder with NO facility assignments at all', () => {
    const row = { facilityScoped: true, facilityIds: ['fac-1'] };

    expect(assignmentAdmitsHolder(row, [])).toBe(false);
  });

  it('FAIL-CLOSED: an assignment narrowed to an empty facilityIds ([]) admits NOBODY — never everybody', () => {
    const row = { facilityScoped: true, facilityIds: [] };

    expect(assignmentAdmitsHolder(row, ['fac-1'])).toBe(false);
    expect(assignmentAdmitsHolder(row, [])).toBe(false);
  });
});
