/**
 * POST /api/system/reminders/run
 *
 * Manually triggers a reminder & escalation sweep. Runs the sweep inline so the
 * response carries the resulting summary directly (handy for staging/dry-run
 * verification), and also ensures the singleton worker + cron schedule are
 * running so the scheduled path keeps firing.
 *
 * Body: { dryRun?: boolean } — when true, the sweep logs intended sends and
 * performs zero writes.
 *
 * This endpoint is system-admin gated — anonymous callers receive 401.
 */

import { NextResponse } from 'next/server';
import { verifySystemAdminCookie } from '@/lib/system-auth';
import { getReminderSweepWorker, runReminderSweepJob } from '@/lib/queue/reminder-sweep-worker';
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
    getReminderSweepWorker();

    // Run inline for instant feedback — returns the summary in the response.
    const summary = await runReminderSweepJob(dryRun);
    logger.info({ msg: '[reminders] Manual sweep run complete', dryRun, ...summary });

    return NextResponse.json({ ok: true, dryRun, summary });
  } catch (err) {
    logger.error({ msg: '[reminders] Manual sweep run failed', dryRun, err });
    return NextResponse.json({ error: 'Failed to run reminder sweep' }, { status: 500 });
  }
}
