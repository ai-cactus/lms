import type { Role } from '@/types/next-auth';

export interface ProfileData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  roleDisplayName: string;
  jobTitle?: string;
  avatarUrl?: string | null;
  avatarDisplayUrl?: string | null;
  authProvider?: string;
}

/**
 * The organization panel spans two tables: the org-level identity columns live
 * on Organization, while location, credentialing and services moved onto the
 * member's Facility when facilities became a first-class tenant sub-unit.
 * `updateOrganization` accepts and routes both halves, so they are carried
 * together here rather than split across two props.
 */
export interface OrganizationSectionData {
  id: string;
  name: string;
  dba: string | null;
  ein: string | null;
  primaryContact: string | null;
  primaryEmail: string | null;
  isHipaaCompliant: boolean;
  primaryBusinessType: string | null;
  additionalBusinessTypes: string[];
  staffCount: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zipCode: string | null;
  licenseNumber: string | null;
  programServices: string[];
}

export interface ComplianceDocument {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** Signed, time-limited link; null when the object could not be signed. */
  displayUrl: string | null;
}

export interface FacilityCardData {
  id: string;
  name: string;
  type: string | null;
  address: string | null;
  supervisorName: string | null;
  supervisorEmail: string | null;
}

/** Which facility list the left nav offers — the two variants in the mocks. */
export type FacilitiesMode = 'organization' | 'assigned' | 'none';
