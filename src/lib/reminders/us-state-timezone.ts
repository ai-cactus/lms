import { DEFAULT_TZ } from './time';

/**
 * US state → representative IANA timezone.
 *
 * Keyed by the 2-letter state code that the onboarding state dropdown stores
 * (`src/app/onboarding/step1/page.tsx`) and the org-settings form persists
 * (`src/components/dashboard/OrganizationForm.tsx`) — both use `value: 'NY'`,
 * `value: 'CA'`, etc.
 *
 * States spanning multiple zones are mapped to their most-populous zone; an
 * admin can override the derived value in org settings (Phase 9). Country is
 * locked to `US`, so only US states (plus DC) are represented.
 */
export const US_STATE_TO_TZ: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
};

/**
 * Derive an IANA timezone from a stored US state code. Case-insensitive and
 * whitespace-tolerant. Returns {@link DEFAULT_TZ} for unknown/empty input.
 */
export function deriveTimezoneFromState(state: string | null | undefined): string {
  if (!state) return DEFAULT_TZ;
  const key = state.trim().toUpperCase();
  return US_STATE_TO_TZ[key] ?? DEFAULT_TZ;
}
