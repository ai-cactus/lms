/**
 * Unit tests for src/lib/reminders/us-state-timezone.ts
 *
 * Pure module — no mocks required.
 */
import { describe, it, expect } from 'vitest';
import { deriveTimezoneFromState, US_STATE_TO_TZ } from './us-state-timezone';
import { DEFAULT_TZ } from './time';

describe('deriveTimezoneFromState', () => {
  // -------------------------------------------------------------------------
  // Known state codes
  // -------------------------------------------------------------------------
  it('resolves NY to America/New_York', () => {
    expect(deriveTimezoneFromState('NY')).toBe('America/New_York');
  });

  it('resolves CA to America/Los_Angeles', () => {
    expect(deriveTimezoneFromState('CA')).toBe('America/Los_Angeles');
  });

  it('resolves HI to Pacific/Honolulu', () => {
    expect(deriveTimezoneFromState('HI')).toBe('Pacific/Honolulu');
  });

  it('resolves TX to America/Chicago (representative zone for Texas)', () => {
    expect(deriveTimezoneFromState('TX')).toBe('America/Chicago');
  });

  it('resolves AK to America/Anchorage', () => {
    expect(deriveTimezoneFromState('AK')).toBe('America/Anchorage');
  });

  it('resolves DC to America/New_York', () => {
    expect(deriveTimezoneFromState('DC')).toBe('America/New_York');
  });

  // -------------------------------------------------------------------------
  // Case / whitespace tolerance
  // -------------------------------------------------------------------------
  it('is case-insensitive: "ny" resolves to America/New_York', () => {
    expect(deriveTimezoneFromState('ny')).toBe('America/New_York');
  });

  it('is case-insensitive: "Ca" resolves to America/Los_Angeles', () => {
    expect(deriveTimezoneFromState('Ca')).toBe('America/Los_Angeles');
  });

  it('trims leading and trailing whitespace: " NY " resolves correctly', () => {
    expect(deriveTimezoneFromState(' NY ')).toBe('America/New_York');
  });

  it('handles mixed case with whitespace: " hi " → Pacific/Honolulu', () => {
    expect(deriveTimezoneFromState(' hi ')).toBe('Pacific/Honolulu');
  });

  // -------------------------------------------------------------------------
  // Unknown / empty inputs → DEFAULT_TZ fallback
  // -------------------------------------------------------------------------
  it('returns DEFAULT_TZ for an unknown state code', () => {
    expect(deriveTimezoneFromState('XX')).toBe(DEFAULT_TZ);
  });

  it('returns DEFAULT_TZ for an empty string', () => {
    expect(deriveTimezoneFromState('')).toBe(DEFAULT_TZ);
  });

  it('returns DEFAULT_TZ for null', () => {
    expect(deriveTimezoneFromState(null)).toBe(DEFAULT_TZ);
  });

  it('returns DEFAULT_TZ for undefined', () => {
    expect(deriveTimezoneFromState(undefined)).toBe(DEFAULT_TZ);
  });

  it('returns DEFAULT_TZ for a whitespace-only string', () => {
    expect(deriveTimezoneFromState('   ')).toBe(DEFAULT_TZ);
  });

  // -------------------------------------------------------------------------
  // Map completeness: all 51 entries are valid IANA zones
  // -------------------------------------------------------------------------
  it('US_STATE_TO_TZ covers 51 entries (50 states + DC)', () => {
    expect(Object.keys(US_STATE_TO_TZ).length).toBe(51);
  });

  it('every entry in US_STATE_TO_TZ is a non-empty string', () => {
    for (const [code, tz] of Object.entries(US_STATE_TO_TZ)) {
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
      // Spot-check format: IANA zones contain a slash or are 'UTC'
      expect(tz).toMatch(/\/|\bUTC\b/);
      void code; // suppress unused-var warning
    }
  });
});
