/**
 * Plan seat-limit enforcement (F-022).
 *
 * Single place that answers "does this organization have room for another
 * worker?". It resolves the org's active subscription plan and its `staffMax`
 * from {@link BILLING_PLANS} — the SAME source the checkout route uses — so the
 * limit can never drift from a hardcoded second copy.
 *
 * Used at two points:
 *  - bulk invite issuance (block sending more invites than remaining seats), and
 *  - invite acceptance, re-checked INSIDE the accept transaction so a seat that
 *    fills between issuance and acceptance is caught race-safely (pass the
 *    transaction client via `options.client`).
 */
import prisma from '@/lib/prisma';
import { BILLING_PLANS } from '@/lib/billing-plans';

/**
 * The Prisma delegates this module needs. Both the base client and a
 * transaction client (`Prisma.TransactionClient`) satisfy this, so callers can
 * run the check inside an existing `$transaction` for race safety.
 */
type SeatDbClient = Pick<typeof prisma, 'organization' | 'user' | 'invite'>;

export interface SeatUsage {
  /** Max staff seats for the org's active plan; `null` when unlimited or unenforced. */
  staffMax: number | null;
  /** Human-readable plan name, when a plan is resolved. */
  planName: string | null;
  /** Seats currently consumed: active workers (+ pending invites when requested). */
  current: number;
}

export interface SeatUsageOptions {
  /**
   * Count non-expired pending invites toward usage. Enable at issuance time so
   * outstanding invites reserve seats; leave off for acceptance, where only
   * materialised workers consume a seat. Default `false`.
   */
  includePendingInvites?: boolean;
  /** Prisma client or transaction client to run counts against. Default: shared client. */
  client?: SeatDbClient;
}

/** Raised when a seat-consuming action would exceed the org's plan staff limit. */
export class SeatLimitError extends Error {
  readonly current: number;
  readonly limit: number;
  readonly planName: string;

  constructor(current: number, limit: number, planName: string) {
    super(
      `Your ${planName} plan allows up to ${limit} worker${limit === 1 ? '' : 's'}. ` +
        `Adding more would exceed that limit. Please upgrade your plan to add more workers.`,
    );
    this.name = 'SeatLimitError';
    this.current = current;
    this.limit = limit;
    this.planName = planName;
  }
}

/**
 * Resolve the org's current seat usage against its active subscription plan.
 * Returns `staffMax: null` (nothing to enforce) when the org has no active
 * subscription, its subscription is canceled, or it is on an unlimited plan.
 */
export async function getSeatUsage(
  organizationId: string,
  options: SeatUsageOptions = {},
): Promise<SeatUsage> {
  const { includePendingInvites = false, client = prisma } = options;

  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { subscription: { select: { plan: true, status: true } } },
  });

  const subscription = org?.subscription;
  // No org, no subscription, or a canceled one → nothing to enforce.
  if (!subscription || subscription.status === 'canceled') {
    return { staffMax: null, planName: null, current: 0 };
  }

  const planConfig = BILLING_PLANS.find((p) => p.key === subscription.plan);
  if (!planConfig || planConfig.staffMax === null) {
    return { staffMax: null, planName: planConfig?.name ?? null, current: 0 };
  }

  const [workerCount, pendingInviteCount] = await Promise.all([
    client.user.count({ where: { organizationId, role: 'worker' } }),
    includePendingInvites
      ? client.invite.count({
          where: { organizationId, status: 'pending', expiresAt: { gt: new Date() } },
        })
      : Promise.resolve(0),
  ]);

  return {
    staffMax: planConfig.staffMax,
    planName: planConfig.name,
    current: workerCount + pendingInviteCount,
  };
}

export interface AssertSeatOptions extends SeatUsageOptions {
  /** How many new seats the action will consume. Default `1`. */
  seatsNeeded?: number;
}

/**
 * Throw {@link SeatLimitError} if consuming `seatsNeeded` seats would push the
 * org beyond its plan staff limit. No-op when the plan is unlimited/unenforced.
 * Pass a transaction client via `options.client` to make the check race-safe
 * against concurrent seat-filling operations.
 */
export async function assertSeatAvailable(
  organizationId: string,
  options: AssertSeatOptions = {},
): Promise<void> {
  const { seatsNeeded = 1, ...usageOptions } = options;
  const usage = await getSeatUsage(organizationId, usageOptions);

  if (usage.staffMax === null) return; // unlimited / no active plan to enforce

  if (usage.current + seatsNeeded > usage.staffMax) {
    throw new SeatLimitError(usage.current, usage.staffMax, usage.planName ?? 'current');
  }
}
