/**
 * POST /api/system/notifications/run
 *
 * Manually triggers a notification digest run. Runs inline so the response
 * carries the resulting summary directly (handy for staging/dry-run
 * verification), and also ensures the singleton worker + cron schedule are
 * running so the scheduled path keeps firing.
 *
 * Body:
 *   - `dryRun?: boolean` — when true, log intended sends and perform zero writes.
 *   - `force?: boolean`  — staging escape hatch: drop this period's claim rows so
 *     an organization already digested today can be digested again.
 *
 * This endpoint is system-admin gated — anonymous callers receive 401.
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { periodKeyFor } from '@/lib/notifications/digest';
import {
  getNotificationDigestWorker,
  runNotificationDigestJob,
} from '@/lib/queue/notification-digest-worker';
import { logger } from '@/lib/logger';

/**
 * Clear the claim rows for the current period so a re-run is possible. Only
 * `claimed`/`failed` rows are removed — a `sent` run stays put so forcing can
 * never silently re-send a digest that already reached recipients.
 */
async function clearCurrentPeriodClaims(now: Date): Promise<number> {
  const periodKeys = [periodKeyFor('daily', now), periodKeyFor('weekly', now)];
  const { count } = await prisma.notificationDigestRun.deleteMany({
    where: { periodKey: { in: periodKeys }, status: { in: ['claimed', 'failed'] } },
  });
  return count;
}

export async function POST(request: Request) {
  const isAuth = await verifySystemAdminCookie();
  if (!isAuth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; force?: boolean };
  const dryRun = body.dryRun === true;
  const force = body.force === true;

  try {
    // Ensure the worker (and its cron schedule) is running for the scheduled path.
    getNotificationDigestWorker();

    let clearedClaims = 0;
    if (force && !dryRun) {
      clearedClaims = await clearCurrentPeriodClaims(new Date());
      logger.warn({ msg: '[notifications] Forced digest re-run — claims cleared', clearedClaims });
    }

    // Run inline for instant feedback — returns the summary in the response.
    const summary = await runNotificationDigestJob(dryRun);
    logger.info({ msg: '[notifications] Manual digest run complete', dryRun, force, ...summary });

    return NextResponse.json({ ok: true, dryRun, force, clearedClaims, summary });
  } catch (err) {
    logger.error({ msg: '[notifications] Manual digest run failed', dryRun, force, err });
    return NextResponse.json({ error: 'Failed to run notification digest' }, { status: 500 });
  }
}
