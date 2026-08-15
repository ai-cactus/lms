/**
 * Unit tests for the `?facility=` grammar shared by the client control and the
 * server that re-authorises the scope.
 */
import { describe, it, expect } from 'vitest';
import {
  FACILITY_SCOPE_PARAM,
  MIN_COMPARISON_FACILITIES,
  parseFacilityScopeParam,
  serializeFacilityScopeParam,
} from './scope-param';

describe('parseFacilityScopeParam', () => {
  it.each([undefined, null, '', '   ', ',', ' , , '])('returns [] for %j', (param) => {
    expect(parseFacilityScopeParam(param)).toEqual([]);
  });

  it('returns the single id of a drill-down request', () => {
    expect(parseFacilityScopeParam('fac-a')).toEqual(['fac-a']);
  });

  it('splits a comparison request on commas and trims each id', () => {
    expect(parseFacilityScopeParam(' fac-a , fac-b ,fac-c')).toEqual(['fac-a', 'fac-b', 'fac-c']);
  });

  it('drops duplicates while preserving first-seen order', () => {
    expect(parseFacilityScopeParam('fac-b,fac-a,fac-b')).toEqual(['fac-b', 'fac-a']);
  });

  it('flattens a repeated param (?facility=a&facility=b) into one id list', () => {
    expect(parseFacilityScopeParam(['fac-a', 'fac-b,fac-c'])).toEqual(['fac-a', 'fac-b', 'fac-c']);
  });
});

describe('serializeFacilityScopeParam', () => {
  it('returns null for an empty selection so the param is removed, not blanked', () => {
    expect(serializeFacilityScopeParam([])).toBeNull();
    expect(serializeFacilityScopeParam(['', '  '])).toBeNull();
  });

  it('writes a single id unchanged', () => {
    expect(serializeFacilityScopeParam(['fac-a'])).toBe('fac-a');
  });

  it('joins a comparison selection with commas, round-tripping through the parser', () => {
    const value = serializeFacilityScopeParam(['fac-a', 'fac-b']);

    expect(value).toBe('fac-a,fac-b');
    expect(parseFacilityScopeParam(value)).toEqual(['fac-a', 'fac-b']);
  });
});

describe('constants', () => {
  it('names the query parameter and the comparison threshold', () => {
    expect(FACILITY_SCOPE_PARAM).toBe('facility');
    expect(MIN_COMPARISON_FACILITIES).toBe(2);
  });
});
