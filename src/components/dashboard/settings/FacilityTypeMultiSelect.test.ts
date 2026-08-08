/**
 * The stored `Facility.type` column is a single string: canonical labels joined
 * with ", ", optionally ending in ONE free-text ("Other") entry. These helpers
 * must round-trip that format — including a custom label that itself contains
 * ", ", which naive splitting would shred into fake entries.
 */
import { describe, expect, it } from 'vitest';
import { FACILITY_TYPE_OPTIONS, OTHER_FACILITY_TYPE } from '@/lib/facility/facility-type-options';
import { joinFacilityTypes, parseFacilityTypes } from './FacilityTypeMultiSelect';

const [TYPE_A, TYPE_B, TYPE_C] = FACILITY_TYPE_OPTIONS;

describe('parseFacilityTypes', () => {
  it('returns empty selections for null/empty storage', () => {
    expect(parseFacilityTypes(null)).toEqual({ types: [], otherText: '' });
    expect(parseFacilityTypes('')).toEqual({ types: [], otherText: '' });
  });

  it('splits a multi-type string into canonical selections', () => {
    expect(parseFacilityTypes(`${TYPE_A}, ${TYPE_B}, ${TYPE_C}`)).toEqual({
      types: [TYPE_A, TYPE_B, TYPE_C],
      otherText: '',
    });
  });

  it('maps a non-canonical tail onto the Other sentinel', () => {
    expect(parseFacilityTypes(`${TYPE_A}, Animal Therapy Annex`)).toEqual({
      types: [TYPE_A, OTHER_FACILITY_TYPE],
      otherText: 'Animal Therapy Annex',
    });
  });

  it('re-joins a custom label that itself contains ", "', () => {
    expect(parseFacilityTypes('Annex, East Wing')).toEqual({
      types: [OTHER_FACILITY_TYPE],
      otherText: 'Annex, East Wing',
    });
  });

  it('treats a legacy single canonical value as one selection', () => {
    expect(parseFacilityTypes(TYPE_A)).toEqual({ types: [TYPE_A], otherText: '' });
  });
});

describe('joinFacilityTypes', () => {
  it('joins canonical selections in registry order with the custom text last', () => {
    expect(
      joinFacilityTypes({ types: [TYPE_C, TYPE_A, OTHER_FACILITY_TYPE], otherText: ' Annex ' }),
    ).toBe(`${TYPE_A}, ${TYPE_C}, Annex`);
  });

  it('drops the sentinel when its text is blank and returns "" for no selection', () => {
    expect(joinFacilityTypes({ types: [OTHER_FACILITY_TYPE], otherText: '  ' })).toBe('');
    expect(joinFacilityTypes({ types: [], otherText: 'ignored' })).toBe('');
  });

  it('round-trips through parseFacilityTypes', () => {
    const joined = joinFacilityTypes({
      types: [TYPE_A, TYPE_B, OTHER_FACILITY_TYPE],
      otherText: 'Annex, East Wing',
    });
    expect(parseFacilityTypes(joined)).toEqual({
      types: [TYPE_A, TYPE_B, OTHER_FACILITY_TYPE],
      otherText: 'Annex, East Wing',
    });
  });
});
