/**
 * The Q-23 sign-in guard, as a pure predicate so every auth entry point can
 * share it without importing the delete machinery.
 *
 * A soft-deleted identity (`User.deletedAt` set, see
 * `src/lib/system/delete-user.ts`) keeps its row so its compliance records keep
 * an owner, which means every "does this email exist" lookup still finds it.
 * Each entry point therefore selects `deletedAt` and refuses when this returns
 * true — answering exactly as it would for an unknown account wherever the
 * caller is not yet authenticated, so the response never reveals that the
 * account existed.
 */
export function isDeletedIdentity(user: { deletedAt: Date | null } | null | undefined): boolean {
  return user?.deletedAt != null;
}

/**
 * Thrown by `createMembership` when asked to attach a deleted identity to an
 * organization. Every invite, join-code and onboarding path funnels through
 * that one function, so this is the backstop that keeps a deleted person from
 * regaining a membership even if an entry point's own guard were missed.
 */
export class DeletedIdentityError extends Error {
  constructor() {
    super('This account has been deleted and cannot join an organization.');
    this.name = 'DeletedIdentityError';
  }
}
