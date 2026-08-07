/**
 * The facility types offered wherever a facility is created or edited.
 *
 * `Facility.type` is a free-form string column, so `OTHER_FACILITY_TYPE` lets an
 * organisation record a type that is not on this list without a schema change —
 * the chosen list is a convenience, never a constraint.
 */
export const FACILITY_TYPE_OPTIONS = [
  'Community Mental Health Center',
  'Substance Use Disorder (SUD) Treatment Provider',
  'Behavioral Health Hospital / Psychiatric Hospital',
  'Integrated Primary Care with Behavioral Health (e.g., FQHC)',
  'Private Practice / Group Practice',
  'Telehealth-Only Behavioral Health Provider',
  'School- or Campus-Based Behavioral Health Program',
  'Correctional / Justice-Involved Behavioral Health Program',
] as const;

/** Sentinel option that reveals a free-text field for an unlisted type. */
export const OTHER_FACILITY_TYPE = 'Other (specify)';
