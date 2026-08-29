/**
 * POST /api/system/billing/pause-sweep/run
 *
 * Manually triggers the billing pending-pause sweep. Runs it inline so the
 * response carries the summary directly, and also ensures the singleton worker
 * and its cron schedule are running so the scheduled path keeps firing.
 *
 * Why this exists: the sweep is the only thing that turns a REQUESTED pause into
 * a real one, it runs on a quarter-hourly cron, and its correctness depends on
 * landing before Stripe renews. Without a trigger, verifying it against a real
 * Stripe subscription costs a fifteen-minute wait per attempt, and an operator
 * who notices a missed pause has no way to force one.
 *
 * Body: { dryRun?: boolean } — when true, logs intended pauses and performs zero
 * writes, locally or on Stripe.
 *
 * System-admin gated — anonymous callers receive 401.
 */

import { NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import {
  getBillingPauseSweepWorker,
  runBillingPauseSweepJob,
} from '@/lib/queue/billing-pause-sweep-worker';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  const isAuth = await verifySystemAdminCookie();
  if (!isAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun === true;

  try {
    // Ensure the worker (and its cron schedule) is running for the scheduled path.
    getBillingPauseSweepWorker();

    const summary = await runBillingPauseSweepJob(dryRun);
    logger.info({ msg: '[billing] Manual pause sweep run complete', dryRun, ...summary });

    return NextResponse.json({ ok: true, dryRun, summary });
  } catch (err) {
    logger.error({ msg: '[billing] Manual pause sweep run failed', dryRun, err });
    return NextResponse.json({ error: 'Failed to run billing pause sweep' }, { status: 500 });
  }
}
