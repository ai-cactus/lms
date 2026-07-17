-- Subscription plan-change / proration policy (Phase 4, Issue 3).
-- Hand-authored (not `migrate dev` autogen) so it carries ONLY these five new
-- columns — the diff engine otherwise tries to drop the raw-SQL-managed
-- `manual_chunks` pgvector column/index and the DB-level defaults on `facilities`.
--
-- These columns hold a PENDING future plan change that takes effect at
-- current_period_end (all NULL = no pending change). The existing plan /
-- billing_cycle / stripe_price_id columns continue to represent what is live now.

ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan" "SubscriptionPlan";
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_billing_cycle" "SubscriptionBillingCycle";
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_price_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_effective_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN "stripe_schedule_id" TEXT;

-- One subscription schedule maps to at most one subscription row.
CREATE UNIQUE INDEX "subscriptions_stripe_schedule_id_key" ON "subscriptions"("stripe_schedule_id");
