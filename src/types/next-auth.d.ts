export type Role =
  | 'owner'
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

declare module 'next-auth' {
  interface User {
    id: string;
    role: Role;
    organizationId: string | null;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: Role;
      organizationId: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    organizationId: string | null;
  }
}

// ✅ Typed helper so you never access session fields without knowing their shape
export type AuthSession = {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role: Role;
    organizationId: string | null;
  };
};
