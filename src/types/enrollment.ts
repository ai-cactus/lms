/**
 * Represents a single staff member to be enrolled in a course.
 * Sourced either from manual email input or from a CSV upload
 * containing First Name, Last Name, Role, and Email columns.
 */
export interface StaffEntry {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Defaults to 'worker' when omitted or unrecognised. */
  role?: 'admin' | 'worker';
}
