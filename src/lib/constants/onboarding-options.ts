/**
 * Canonical option sets shared by the onboarding wizard (step 3) and the
 * read-only organization / facility profile panels, so the ids persisted at
 * onboarding time can always be resolved back to a label for display.
 */

export const OTHER_OPTION_ID = 'other';

export interface OnboardingOption {
  id: string;
  label: string;
}

export const PRIMARY_BUSINESS_TYPES: readonly OnboardingOption[] = [
  { id: 'community_mental_health', label: 'Community Mental Health Center' },
  { id: 'sud_treatment_provider', label: 'Substance Use Disorder (SUD) Treatment Provider' },
  { id: 'behavioral_hospital', label: 'Behavioral Health Hospital / Psychiatric Hospital' },
  {
    id: 'integrated_primary_care',
    label: 'Integrated Primary Care with Behavioral Health (e.g., FQHC)',
  },
  { id: 'private_group_practice', label: 'Private Practice / Group Practice' },
  { id: 'telehealth_only', label: 'Telehealth-Only Behavioral Health Provider' },
  { id: 'school_campus_program', label: 'School- or Campus-Based Behavioral Health Program' },
  {
    id: 'correctional_justice',
    label: 'Correctional / Justice-Involved Behavioral Health Program',
  },
  { id: OTHER_OPTION_ID, label: 'Other (Specify)' },
];

export const ADDITIONAL_BUSINESS_TYPES: readonly OnboardingOption[] = [
  { id: 'outpatient_services', label: 'Outpatient Services' },
  { id: 'iop_php', label: 'Intensive Outpatient (IOP) / Partial Hospitalization (PHP)' },
  { id: 'residential_inpatient', label: 'Residential / Inpatient Facility' },
  { id: 'detox_withdrawal', label: 'Detoxification / Withdrawal Management' },
  { id: 'crisis_stabilization', label: 'Crisis Stabilization Unit' },
  { id: 'long_term_care', label: 'Long-Term Care Program' },
  { id: 'co_occurring_dual_dx', label: 'Co-Occurring / Dual-Diagnosis Program' },
  { id: OTHER_OPTION_ID, label: 'Other (specify)' },
];

/** Ids are load-bearing: existing production facilities store these exact strings. */
export const PROGRAM_SERVICES: readonly OnboardingOption[] = [
  { id: 'aging', label: 'Aging Services' },
  { id: 'behavioral', label: 'Behavioral Health' },
  { id: 'child-youth', label: 'Child & Youth Services' },
  { id: 'employment', label: 'Employment & Community Services' },
  { id: 'medical-rehab', label: 'Medical Rehabilitation' },
  { id: 'opioid', label: 'Opioid Treatment Program' },
  { id: 'vision', label: 'Vision Rehabilitation Services' },
  { id: OTHER_OPTION_ID, label: 'Other (specify)' },
];

export function getOptionLabel(
  options: readonly OnboardingOption[],
  id: string,
): string | undefined {
  return options.find((option) => option.id === id)?.label;
}
