-- Track when a subscription is paused via Stripe `pause_collection`.
-- Stripe keeps the subscription status as `active` while paused, so a dedicated
-- column is needed to gate access (the "billing gate") during a pause.
ALTER TABLE "subscriptions" ADD COLUMN "paused_at" TIMESTAMP(3);

-- When the pause window ends (max 3 months). After this the admin is prompted
-- to continue (resume) or cancel the plan.
ALTER TABLE "subscriptions" ADD COLUMN "pause_ends_at" TIMESTAMP(3);
