export type Role =
  | 'owner'
  | 'admin'
  | 'supervisor'
  | 'hr'
  | 'clinical_director'
  | 'finance'
  | 'psychiatrist_prescriber'
  | 'nurse'
  | 'therapist_clinician'
  | 'case_manager'
  | 'behavioral_health_technician'
  | 'peer_support_specialist'
  | 'front_desk_admin'
  | 'facilities_support';
import 'next-auth';
import 'next-auth/jwt';

/**
 * Claims resolved from the ACTIVE `OrganizationUser` membership — always from
 * the SAME row, so a role can never be paired with a foreign organization.
 *
 * `organizationId` is the ACTIVE organization this session is scoped to, not
 * "the user's org" (one identity may belong to several). It keeps its original
 * claim name because the Edge proxy reads it straight off the raw token.
 * `organizationUserId` is the membership row that owns every org-scoped
 * artifact this session creates.
 *
 * Both are null only while a prospective founder is mid-onboarding, where
 * `role` is the provisional `owner` they are about to become.
 */
interface MembershipClaims {
  organizationId: string | null;
  organizationUserId: string | null;
  role: Role;
}

declare module 'next-auth' {
  interface User extends MembershipClaims {
    id: string;
  }

  interface Session {
    user: MembershipClaims & {
      id: string;
      email: string;
      name?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends MembershipClaims {
    id: string;
  }
}

// ✅ Typed helper so you never access session fields without knowing their shape
export type AuthSession = {
  user: MembershipClaims & {
    id: string;
    email: string;
    name?: string | null;
  };
};
