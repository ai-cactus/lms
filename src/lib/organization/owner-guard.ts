/**
 * The "an organization always keeps an active owner" invariant (Q-30, RISK-16).
 *
 * Every write that can take an owner seat away — a user delete, a demotion, a
 * deactivation — runs inside a transaction that first locks the organization
 * row with {@link lockOrganizations} and only then checks
 * {@link wouldLeaveOrganizationOwnerless}. Two such writes in one organization
 * therefore serialise: the second re-reads after the first has committed and
 * is refused, instead of both passing a check the other is about to falsify.
 */
import type { DbTransactionClient } from '@/db/index';

type LockClient = Pick<DbTransactionClient, '$queryRaw'>;
type MembershipCounter = Pick<DbTransactionClient, 'organizationUser'>;

/**
 * `SELECT … FOR UPDATE` the organizations, held until the transaction ends.
 * Always in id order, so two transactions locking overlapping sets cannot
 * deadlock.
 */
export async function lockOrganizations(
  tx: LockClient,
  organizationIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(organizationIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

/**
 * True when demoting or deactivating this membership would leave its
 * organization with no active owner. Read it AFTER {@link lockOrganizations}
 * and from the same transaction, against the membership as it stands now.
 */
export async function wouldLeaveOrganizationOwnerless(
  tx: MembershipCounter,
  membership: { id: string; organizationId: string; role: string; active: boolean },
): Promise<boolean> {
  if (membership.role !== 'owner' || !membership.active) return false;

  const otherOwners = await tx.organizationUser.count({
    where: {
      organizationId: membership.organizationId,
      active: true,
      role: 'owner',
      id: { not: membership.id },
    },
  });
  return otherOwners === 0;
}

/** Caller-facing refusal when a write would leave an organization without an owner. */
export const LAST_OWNER_REFUSAL =
  'This change would leave the organization without an active owner, so it was not made.';

/**
 * Thrown from inside a transaction to abort a write that would leave its
 * organization ownerless. Server Actions catch it and RETURN
 * {@link LAST_OWNER_REFUSAL}; production redacts thrown messages.
 */
export class LastOwnerError extends Error {
  constructor() {
    super(LAST_OWNER_REFUSAL);
    this.name = 'LastOwnerError';
  }
}
