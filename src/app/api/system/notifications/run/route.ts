/**
 * POST /api/system/notifications/run
 *
 * Manually triggers whichever batched email run is live: the unified cycle
 * summary when CYCLE_SUMMARY_ENABLED is on, the notification digest otherwise.
 * The branch is not a convenience — both runs claim the same
 * `CycleSummaryRun (organizationId, periodKey)` row, so triggering a digest
 * after the cutover would consume the day's claim and suppress the real summary.
 *
 * Runs inline so the response carries the resulting summary directly (handy for
 * staging/dry-run verification), and also ensures the singleton worker + cron
 * schedule are running so the scheduled path keeps firing.
 *
 * Body:
 *   - `dryRun?: boolean` — when true, log intended sends and perform zero writes.
 *   - `force?: boolean`  — staging escape hatch: drop this period's claim rows so
 *     an organization already summarized today can be summarized again.
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
import { getCycleSummaryWorker, runCycleSummaryJob } from '@/lib/queue/cycle-summary-worker';
import { isCycleSummaryEnabled } from '@/lib/cycle-summary/flag';
import { logger } from '@/lib/logger';

/**
 * Clear the claim rows for the current period so a re-run is possible. Only
 * `claimed`/`failed` rows are removed — a `sent` run stays put so forcing can
 * never silently re-send a digest that already reached recipients.
 */
async function clearCurrentPeriodClaims(now: Date): Promise<number> {
  const periodKeys = [periodKeyFor('daily', now), periodKeyFor('weekly', now)];
  const { count } = await prisma.cycleSummaryRun.deleteMany({
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

  const mode = isCycleSummaryEnabled() ? 'cycle_summary' : 'digest';

  try {
    // Ensure the worker (and its cron schedule) is running for the scheduled
    // path. Each getter is a no-op for the mode that is not live.
    getNotificationDigestWorker();
    getCycleSummaryWorker();

    let clearedClaims = 0;
    if (force && !dryRun) {
      clearedClaims = await clearCurrentPeriodClaims(new Date());
      logger.warn({ msg: '[notifications] Forced re-run — claims cleared', mode, clearedClaims });
    }

    // Run inline for instant feedback — returns the summary in the response.
    const summary =
      mode === 'cycle_summary'
        ? await runCycleSummaryJob(dryRun)
        : await runNotificationDigestJob(dryRun);
    logger.info({ msg: '[notifications] Manual run complete', mode, dryRun, force, ...summary });

    return NextResponse.json({ ok: true, mode, dryRun, force, clearedClaims, summary });
  } catch (err) {
    logger.error({ msg: '[notifications] Manual run failed', mode, dryRun, force, err });
    return NextResponse.json({ error: 'Failed to run batched email job' }, { status: 500 });
  }
}
