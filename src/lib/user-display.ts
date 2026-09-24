/**
 * One display name for a user across the system-admin surfaces.
 *
 * A profile may carry `fullName` alone (OAuth signup writes only that),
 * `firstName`/`lastName` alone, or neither — so every branch needs a fallback
 * or the UI renders an empty name with nothing to say who it belongs to.
 */

export interface UserNameParts {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function getUserDisplayName(name: UserNameParts | null | undefined, email: string): string {
  const fullName = name?.fullName?.trim();
  if (fullName) return fullName;

  const composed = [name?.firstName, name?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  if (composed) return composed;

  return email.split('@')[0] || email;
}

/** Last resort for a row carrying neither a name nor a usable email. */
const UNKNOWN_INITIALS = '?';

export function getUserInitials(name: UserNameParts | null | undefined, email: string): string {
  const initials = getUserDisplayName(name, email)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return initials || UNKNOWN_INITIALS;
}
